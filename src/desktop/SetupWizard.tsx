import { useCallback, useEffect, useState } from 'react'
import { api, onServiceEvent, pickProjectsFolder, setProjectsFolder } from './client'
import type { SetupState, StarterProgress } from './types'
import { Icon } from './Icons'

const STEPS = ['You', 'Projects', 'Agents', 'Tools', 'Voice'] as const
const message = (error: unknown) => error instanceof Error ? error.message : String(error)

// First-run setup, also reopened from Settings. Every step can be skipped and done later.
export default function SetupWizard({ onClose, onStepAside }: { onClose: () => void; onStepAside: () => void }) {
  const [state, setState] = useState<SetupState | null>(null)
  const [step, setStep] = useState(0)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const refresh = useCallback(() => api<SetupState>('/setup').then(setState).catch(err => setError(message(err))), [])
  useEffect(() => { void refresh() }, [refresh])
  // Install and sign-in happen in a chat terminal, so keep checking while those steps are open.
  useEffect(() => {
    if (STEPS[step] !== 'Agents') return
    const timer = window.setInterval(() => void refresh(), 4000)
    return () => window.clearInterval(timer)
  }, [step, refresh])
  const run = async (task: () => Promise<unknown>) => {
    setBusy(true); setError('')
    try { await task() } catch (err) { setError(message(err)) } finally { setBusy(false) }
  }
  const finish = () => run(async () => { await api('/setup/done', { done: true }); onClose() })
  const next = () => step < STEPS.length - 1 ? setStep(step + 1) : void finish()
  if (!state) return <div className="desk-scrim"><div className="desk-dialog setup-dialog"><p className="desk-muted">{error || 'Loading setup…'}</p></div></div>
  return <div className="desk-scrim" role="dialog" aria-modal="true" aria-label="Set up Jupiter">
    <div className="desk-dialog setup-dialog">
      <div className="desk-dialog-heading"><div><span className="desk-eyebrow">SET UP JUPITER · {step + 1} OF {STEPS.length}</span><h2>{STEPS[step] === 'You' ? 'Welcome' : STEPS[step]}</h2></div>
        <button className="desk-icon" onClick={() => void finish()} aria-label="Close setup"><Icon name="close" size={17} /></button></div>
      <ol className="setup-steps">{STEPS.map((name, index) => <li key={name} className={index === step ? 'current' : index < step ? 'past' : ''}><button type="button" onClick={() => setStep(index)}>{name}</button></li>)}</ol>
      {STEPS[step] === 'You' && <ProfileStep state={state} busy={busy} save={(name, nickname) => run(async () => { await api('/setup/profile', { name, nickname }); await refresh(); next() })} />}
      {STEPS[step] === 'Projects' && <ProjectsStep state={state} busy={busy} change={reset => run(async () => {
        const folder = reset ? null : await pickProjectsFolder()
        if (!reset && !folder) return
        await setProjectsFolder(folder); await refresh()
      })} />}
      {STEPS[step] === 'Agents' && <AgentsStep state={state} busy={busy} act={(agent, action) => run(async () => { await api('/setup/agent', { agent, action }); onStepAside(); await refresh() })} />}
      {STEPS[step] === 'Tools' && <ToolsStep state={state} refresh={refresh} />}
      {STEPS[step] === 'Voice' && <VoiceStep state={state} refresh={refresh} />}
      {error && <p className="desk-error-inline" role="alert">{error}</p>}
      <div className="setup-actions">
        {step > 0 && <button type="button" className="desk-secondary" onClick={() => setStep(step - 1)}>Back</button>}
        {STEPS[step] !== 'You' && <button type="button" className="desk-primary" disabled={busy} onClick={next}>{step === STEPS.length - 1 ? 'Finish' : 'Continue'}</button>}
      </div>
    </div>
  </div>
}

function ProfileStep({ state, busy, save }: { state: SetupState; busy: boolean; save: (name: string, nickname: string) => void }) {
  const [name, setName] = useState(state.profile.name)
  const [nickname, setNickname] = useState(state.profile.nickname)
  return <form onSubmit={event => { event.preventDefault(); save(name, nickname || name) }}>
    <p className="setup-lead">Jupiter and your agents will use these names. They are saved in this repository's <code>context/me.md</code>.</p>
    <label className="desk-field">Your name<input autoFocus value={name} maxLength={60} onChange={event => setName(event.target.value)} placeholder="Alex Morgan" /></label>
    <label className="desk-field">What should Jupiter call you?<input value={nickname} maxLength={60} onChange={event => setNickname(event.target.value)} placeholder={name.split(' ')[0] || 'Alex'} /></label>
    <button type="submit" className="desk-primary setup-wide" disabled={busy || !name.trim()}>Save and continue</button>
  </form>
}

function ProjectsStep({ state, busy, change }: { state: SetupState; busy: boolean; change: (reset: boolean) => void }) {
  return <div>
    <p className="setup-lead">New chats open in a folder inside your projects folder. Point Jupiter at the folder where you keep your work, or keep the one inside this repository.</p>
    <div className="setup-card"><Icon name="folder" size={16} /><span title={state.projects.root}>{state.projects.root}</span></div>
    <div className="setup-row"><button type="button" className="desk-secondary" disabled={busy} onClick={() => change(false)}>Choose folder…</button>
      {state.projects.custom && <button type="button" className="desk-secondary" disabled={busy} onClick={() => change(true)}>Use the default</button>}</div>
  </div>
}

function AgentsStep({ state, busy, act }: { state: SetupState; busy: boolean; act: (agent: string, action: 'install' | 'signin') => void }) {
  const card = (agent: SetupState['agents'][number]) => <div key={agent.id} className="setup-card setup-agent">
    <div><strong>{agent.label}</strong><small>{agent.requirement ? (agent.installed ? 'Installed' : 'Not installed') : agent.signedIn ? 'Installed and signed in' : agent.installed ? 'Installed, not signed in' : 'Not installed'}</small>{!agent.installed && agent.note && <small>{agent.note}</small>}</div>
    {agent.signedIn ? <span className="setup-ok">Ready</span>
      : agent.installed ? <button type="button" className="desk-secondary" disabled={busy} onClick={() => act(agent.id, 'signin')}>Sign in</button>
        : agent.install ? <button type="button" className="desk-secondary" disabled={busy} onClick={() => act(agent.id, 'install')} title={agent.install}>Install</button>
          : <a className="desk-secondary" href={agent.docs} target="_blank" rel="noreferrer">Download</a>}
  </div>
  return <div>
    <p className="setup-lead">Install opens a terminal that runs the official installer, so you can see exactly what runs. Choose Back to setup when it has finished.</p>
    <h3 className="setup-heading">Needed for tools</h3>
    {state.agents.filter(agent => agent.requirement).map(card)}
    <h3 className="setup-heading">Agents (you need at least one)</h3>
    {state.agents.filter(agent => !agent.requirement).map(card)}
    <p className="desk-muted setup-note">Sign in starts the agent, which opens your browser. Claude Code needs a Pro, Max, Team or Console account; Codex needs a ChatGPT plan or an API key.</p>
  </div>
}

function ToolsStep({ state, refresh }: { state: SetupState; refresh: () => Promise<void> }) {
  const [agree, setAgree] = useState(false)
  const [running, setRunning] = useState(state.starterRunning)
  const [progress, setProgress] = useState<Record<string, StarterProgress>>({})
  const [error, setError] = useState('')
  useEffect(() => onServiceEvent(event => {
    if (event.type !== 'setup-progress') return
    if (event.progress) { const item = event.progress; setProgress(current => ({ ...current, [item.id]: item })) }
    if (event.done || event.error) { setRunning(false); if (event.error) setError(event.error); void refresh() }
  }), [refresh])
  const pending = state.starter.filter(item => item.state === 'available')
  const claude = state.agents.find(agent => agent.id === 'claude')
  const missing = state.agents.filter(agent => agent.requirement && !agent.installed).map(agent => agent.label)
  const blocked = missing.length > 0 || !claude?.installed
  const start = async () => {
    setError('')
    try { await api('/setup/starter', { acceptHooks: true }); setRunning(true) } catch (err) { setError(message(err)) }
  }
  return <div>
    <p className="setup-lead">A free starter set: working methods, document and design skills, a browser for checking UI, current library docs, and three pixel art tools. Paid tools (Higgsfield, fal, Firecrawl) stay optional in Capabilities.</p>
    <ul className="setup-tools">{state.starter.map(item => {
      const live = progress[item.id]
      const label = live ? (live.state === 'installing' ? 'Installing…' : live.state === 'installed' ? 'Installed' : 'Failed') : item.state === 'available' ? 'Not installed' : item.state === 'installed' || item.state === 'present' ? 'Installed' : item.state
      return <li key={item.id} className={live?.state || item.state}><strong>{item.name}</strong><small>{item.what}</small><span>{label}</span>{live?.error && <em>{live.error}</em>}</li>
    })}</ul>
    {blocked && pending.length > 0 && <p className="desk-muted setup-note">Install {[...missing, ...(claude?.installed ? [] : ['Claude Code'])].join(', ')} on the Agents step first. The tools are downloaded with Git, run with Node.js, and several are Claude Code plugins.</p>}
    {pending.length > 0 && !running && <>
      <label className="setup-consent"><input type="checkbox" checked={agree} onChange={event => setAgree(event.target.checked)} />I understand these download code from GitHub and npm at pinned versions, and that some add hooks that run automatically in my agents.</label>
      <button type="button" className="desk-primary setup-wide" disabled={!agree || blocked} onClick={() => void start()}>Install {pending.length} tool{pending.length === 1 ? '' : 's'}</button>
    </>}
    {running && <p className="desk-muted setup-note">Installing. This can take a few minutes; you can continue and come back.</p>}
    {!pending.length && !running && <p className="desk-muted setup-note">The starter set is installed.</p>}
    {error && <p className="desk-error-inline" role="alert">{error}</p>}
  </div>
}

function VoiceStep({ state, refresh }: { state: SetupState; refresh: () => Promise<void> }) {
  const [key, setKey] = useState('')
  const [voices, setVoices] = useState<{ id: string; name: string; category: string | null }[] | null>(null)
  const [voiceId, setVoiceId] = useState(state.elevenlabs.voiceId || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const check = async () => {
    setBusy(true); setError('')
    try {
      const found = (await api<{ voices: { id: string; name: string; category: string | null }[] }>('/setup/elevenlabs/voices', { key })).voices
      setVoices(found); if (!found.some(voice => voice.id === voiceId)) setVoiceId(found[0]?.id || '')
    } catch (err) { setError(message(err)) } finally { setBusy(false) }
  }
  const save = async () => {
    setBusy(true); setError('')
    try { const result = await api<{ voice: string }>('/setup/elevenlabs', { key, voiceId }); setSaved(result.voice); setKey(''); setVoices(null); await refresh() }
    catch (err) { setError(message(err)) } finally { setBusy(false) }
  }
  return <div>
    <p className="setup-lead">Jupiter speaks with an ElevenLabs voice. This is optional and uses your own ElevenLabs credits; common lines are saved after the first time so they are not paid for again.</p>
    {(state.elevenlabs.configured || saved) && <div className="setup-card"><span className="setup-ok">Connected</span><span>{saved ? `Voice: ${saved}` : 'ElevenLabs is set up. Paste a new key below to change it.'}</span></div>}
    <ol className="setup-howto">
      <li>Open <a href="https://elevenlabs.io/app/settings/api-keys" target="_blank" rel="noreferrer">ElevenLabs API keys</a> and create a key.</li>
      <li>Give it <b>Text to Speech: Access</b> and <b>Voices: Read</b>.</li>
      <li>Paste it here, check it, then choose a voice.</li>
    </ol>
    <label className="desk-field">ElevenLabs API key<input type="password" autoComplete="off" spellCheck={false} value={key} onChange={event => { setKey(event.target.value); setVoices(null) }} placeholder="sk_…" /></label>
    {!voices && <button type="button" className="desk-secondary" disabled={busy || !key.trim()} onClick={() => void check()}>{busy ? 'Checking…' : 'Check key'}</button>}
    {voices && <>
      <label className="desk-field">Voice<select value={voiceId} onChange={event => setVoiceId(event.target.value)}>{voices.map(voice => <option key={voice.id} value={voice.id}>{voice.name}{voice.category ? ` (${voice.category})` : ''}</option>)}</select></label>
      <button type="button" className="desk-primary setup-wide" disabled={busy || !voiceId} onClick={() => void save()}>Save voice</button>
    </>}
    <p className="desk-muted setup-note">The key is saved only in this repository's <code>.env</code>, which Git ignores.</p>
    {error && <p className="desk-error-inline" role="alert">{error}</p>}
  </div>
}
