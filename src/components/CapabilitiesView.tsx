import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, isDesktop } from '../desktop/client'
import { checkForUpdates, loadCapabilities, toolEditor, updateCapability, type Capabilities, type Capability, type CapabilityTab, type Hook } from '../lib/capabilities'
import { loadConnections, type Connections, type Server } from '../lib/connections'

const AGENT: Record<string, string> = { claude: 'Claude Code', codex: 'Codex' }
const AGENT_TAGS = new Set(Object.values(AGENT))
const message = (reason: unknown) => reason instanceof Error ? reason.message : String(reason)
const shortVersion = (value?: string | null) => !value ? '' : /^[0-9a-f]{40}$/.test(value) ? value.slice(0, 7) : value
const when = (iso?: string) => iso ? new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''
const titleOf = (item: Capability) => item.title || item.name
const linkOf = (item: Capability) => item.url && (item.site || !item.repo) ? item.url : item.repo ? `https://github.com/${item.repo}` : item.url || ''
// Installed by Jupiter, or already set up on this PC (Unity and Blender). Marketplaces aren't listed.
const listed = (item: Capability) => (item.state === 'installed' || item.state === 'present') && !item.detect?.marketplace

type Status = { cls: 'ok' | 'up' | 'bad' | ''; label: string; title?: string }
function updateStatus(item: Capability, data: Capabilities, checking: boolean, updating: boolean): Status {
  if (updating) return { cls: '', label: 'Updating' }
  if (checking) return { cls: '', label: 'Checking' }
  if (!data.updates) return { cls: '', label: 'Not checked' }
  const result = data.updates.results[item.id]
  if (!item.installed || !result) return { cls: 'bad', label: 'Can’t check', title: `Updates come with ${titleOf(item)}` }
  if (result.status === 'unsupported') return { cls: 'bad', label: 'Can’t check', title: result.reason }
  if (result.status === 'update') return { cls: 'up', label: 'Update available', title: `Update from ${shortVersion(result.current)} to ${shortVersion(result.latest)}` }
  return { cls: 'ok', label: 'Up to date', title: result.hosted ? 'Hosted, so it is always the latest' : undefined }
}

function Pill({ status, onClick }: { status: Status; onClick?: () => void }) {
  const inner = <>{['Checking', 'Updating'].includes(status.label) ? <span className="jh-spin" /> : <i />}{status.label}</>
  return onClick
    ? <button type="button" className={`jh-pill ${status.cls}`} title={status.title} onClick={onClick}>{inner}</button>
    : <span className={`jh-pill ${status.cls}`} title={status.title}>{inner}</span>
}

function Card({ item, data, checking, updating, confirm, onUpdate, onCancel, onEditor }: { item: Capability; data: Capabilities; checking: boolean; updating: boolean; confirm: Hook[] | null; onUpdate: (accept: boolean) => void; onCancel: () => void; onEditor: (action: 'open' | 'stop') => void }) {
  const status = updateStatus(item, data, checking, updating)
  const result = data.updates?.results[item.id]
  const version = result?.hosted ? 'hosted by GitHub' : item.installed ? shortVersion(item.installed.version || item.installed.commit) : ''
  const href = linkOf(item)
  return (
    <article className="jh-cap-card" data-capability={item.id}>
      <header><h3>{titleOf(item)}</h3><Pill status={status} onClick={status.cls === 'up' ? () => onUpdate(false) : undefined} /></header>
      <p className="jh-cap-desc">{item.desc || item.what}</p>
      <div className="jh-cap-chips">{(item.cardTags || []).map(tag => <span key={tag} className={AGENT_TAGS.has(tag) ? 'ice' : undefined}>{tag}</span>)}</div>
      {confirm && <div className="jh-cap-confirm" role="alertdialog" aria-label={`Confirm ${titleOf(item)} update`}>
        <p>This update changes what runs automatically:</p>
        <ul>{confirm.map((hook, index) => <li key={index}><code>{hook.event}</code> {hook.command}</li>)}</ul>
        <div><button type="button" className="jh-mini jh-primary" onClick={() => onUpdate(true)}>Update anyway</button><button type="button" className="jh-mini" onClick={onCancel}>Cancel</button></div>
      </div>}
      <footer>{href && <a className="jh-mini" href={href} target="_blank" rel="noreferrer">{item.site || !item.repo ? 'View site' : 'View on GitHub'}</a>}
        {item.editor && item.state === 'installed' && (item.editorState?.running && item.editorState.url
          ? <><button type="button" className="jh-mini jh-primary" onClick={() => onEditor('open')}>{item.editor.label || 'Open Editor'}</button><button type="button" className="jh-mini" onClick={() => onEditor('stop')}>Stop editor</button></>
          : <button type="button" className="jh-mini jh-primary" onClick={() => onEditor('open')}>{item.editor.label || 'Open Editor'}</button>)}
        <span className="jh-cap-ver">{version}</span></footer>
    </article>
  )
}

const CONNECTION: Record<string, Status> = {
  online: { cls: 'ok', label: 'Connected' }, problem: { cls: 'bad', label: 'Not responding' }, setup: { cls: 'up', label: 'Needs setup' },
  ready: { cls: '', label: 'Not checked' }, off: { cls: '', label: 'Off' }, managed: { cls: '', label: 'Runs with its app' },
}
const RANK = ['problem', 'setup', 'online', 'ready', 'managed', 'off']

function ConnectionsTab({ items }: { items: Capability[] }) {
  const [data, setData] = useState<Connections | null>(null)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState('')
  const refresh = useCallback(async () => { try { setData(await loadConnections()) } catch (reason) { setError(message(reason)) } }, [])
  useEffect(() => { void Promise.resolve().then(refresh) }, [refresh])
  const servers = useMemo(() => data ? [...data.everywhere, ...data.projects.flatMap(project => project.servers)] : [], [data])
  const rows = items.filter(item => item.setup?.kind === 'mcp' || item.detect?.mcp).map(item => {
    const names = new Set([item.setup?.server, ...(item.detect?.mcp || [])].filter(Boolean).map(name => String(name).toLowerCase()))
    const mine = servers.filter(server => names.has(server.name.toLowerCase()) && (server.client === 'claude' || server.client === 'codex'))
    const state = mine.map(server => server.state).sort((a, b) => RANK.indexOf(a) - RANK.indexOf(b))[0]
    const status: Status = item.missingEnv?.length ? { cls: 'up', label: 'Needs its key', title: `Set ${item.missingEnv.join(', ')} as a Windows environment variable, then restart Jupiter` }
      : !mine.length ? CONNECTION.managed : CONNECTION[state] || CONNECTION.ready
    return { item, mine, status, agents: [...new Set(mine.map(server => AGENT[server.client]))] }
  })
  const checkAll = async () => {
    setChecking(true); setError('')
    try { for (const server of rows.flatMap(row => row.mine).filter((server: Server) => server.canCheck)) await api('/connections/check', { project: server.project, id: server.id }).catch(() => {}); await refresh() }
    finally { setChecking(false) }
  }
  return <>
    <div className="jh-cap-intro"><div><h3>Connections</h3><p>The MCP servers your agents can use, and whether each one answered when it was last checked.</p></div>
      <div className="jh-cap-check"><button type="button" className="jh-mini jh-primary" disabled={checking || !data} onClick={() => void checkAll()}>{checking ? 'Checking…' : 'Check connections'}</button></div></div>
    {error && <p className="jh-conn-error" role="alert">{error}</p>}
    <div className="jh-cap-rows">{rows.map(({ item, status, agents }) => (
      <div key={item.id} className="jh-cap-row" data-connection={item.id}>
        <div><b>{titleOf(item)}</b><p>{item.desc || item.what}</p>{agents.length === 1 && <div className="jh-cap-chips"><span className="ice">{agents[0]}</span></div>}</div>
        <Pill status={checking ? { cls: '', label: 'Checking' } : status} />
      </div>
    ))}</div>
  </>
}

export default function CapabilitiesView({ initialTab = 'harness' }: { initialTab?: CapabilityTab }) {
  const [data, setData] = useState<Capabilities | null>(null)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<CapabilityTab>(initialTab)
  const [query, setQuery] = useState('')
  const [checking, setChecking] = useState(false)
  const [updating, setUpdating] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ id: string; hooks: Hook[] } | null>(null)
  const [shownTab, setShownTab] = useState(initialTab)
  if (shownTab !== initialTab) { setShownTab(initialTab); setTab(initialTab) }

  const refresh = useCallback(async () => {
    if (!isDesktop) return
    try { setData(await loadCapabilities()); setError('') } catch (reason) { setError(message(reason)) }
  }, [])
  useEffect(() => { void Promise.resolve().then(refresh) }, [refresh])

  const check = async () => {
    setChecking(true); setError('')
    try { const updates = await checkForUpdates(); setData(current => current && { ...current, updates }) }
    catch (reason) { setError(message(reason)) } finally { setChecking(false) }
  }
  const update = async (id: string, accept: boolean) => {
    setUpdating(id); setError(''); setConfirm(null)
    try { const outcome = await updateCapability(id, accept); setData(outcome.list); if (outcome.confirm) setConfirm({ id, hooks: outcome.confirm.hooks }) }
    catch (reason) { setError(message(reason)); await refresh() } finally { setUpdating(null) }
  }

  // The editor runs from Jupiter and opens in its own Jupiter window (in a browser outside the desktop app).
  // Opening it again reuses the same editor; Stop editor, or quitting Jupiter, ends it.
  const editor = async (id: string, action: 'open' | 'stop') => {
    setError('')
    try { const state = await toolEditor(id, action); if (action === 'open' && state.url && !state.window) window.open(state.url, '_blank', 'noreferrer'); await refresh() }
    catch (reason) { setError(message(reason)) }
  }
  const installed = useMemo(() => data?.items.filter(listed) || [], [data])
  const category = data?.categories.find(entry => entry.id === tab)
  const items = installed.filter(item => item.cat === tab && (!query.trim() || `${titleOf(item)} ${item.desc || ''} ${item.name}`.toLowerCase().includes(query.trim().toLowerCase())))
  const pending = data?.updates ? installed.filter(item => data.updates?.results[item.id]?.status === 'update').length : 0
  const tabs: { id: CapabilityTab; label: string; count: number }[] = [
    ...(data?.categories || []).map(entry => ({ id: entry.id as CapabilityTab, label: entry.label, count: installed.filter(item => item.cat === entry.id).length })),
    { id: 'connections', label: 'Connections', count: installed.filter(item => item.setup?.kind === 'mcp' || item.detect?.mcp).length },
  ]

  if (!isDesktop) return <p className="jh-empty">Your plugins and MCP servers live in Claude Code and Codex, so this page needs the Jupiter desktop app.</p>
  return (
    <div className="jh-cap">
      <div className="jh-cap-bar">
        <div className="jh-seg" role="tablist" aria-label="Capability groups">
          {tabs.map(entry => <button key={entry.id} type="button" role="tab" aria-selected={tab === entry.id} aria-pressed={tab === entry.id} onClick={() => setTab(entry.id)}>{entry.label}<span className="jh-cap-n">{entry.count}</span></button>)}
        </div>
        {tab !== 'connections' && <label className="jh-cap-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search your plugins" aria-label="Search your plugins" /></label>}
      </div>
      {error && <p className="jh-conn-error" role="alert">{error}</p>}
      {!data && !error && <p className="jh-empty">Reading what’s installed…</p>}
      {data && tab === 'connections' && <ConnectionsTab items={installed} />}
      {data && tab !== 'connections' && category && <>
        <div className="jh-cap-intro">
          <div><h3>{category.label}</h3><p>{category.blurb}</p></div>
          <div className="jh-cap-check">
            <button type="button" className="jh-mini jh-primary" disabled={checking} onClick={() => void check()}>{checking ? 'Checking…' : data.updates ? 'Check again' : 'Check for updates'}</button>
            <small>{checking ? 'Checking each one…' : !data.updates ? 'Not checked yet' : `${pending ? `${pending} update${pending === 1 ? '' : 's'} available` : 'Everything is up to date'} · ${when(data.updates.checkedAt)}`}</small>
          </div>
        </div>
        <div className="jh-cap-grid">
          {items.map(item => <Card key={item.id} item={item} data={data} checking={checking} updating={updating === item.id}
            confirm={confirm?.id === item.id ? confirm.hooks : null} onUpdate={accept => void update(item.id, accept)} onCancel={() => setConfirm(null)} onEditor={action => void editor(item.id, action)} />)}
          {!items.length && <p className="jh-empty">{query ? 'Nothing matches.' : 'Nothing installed here yet.'}</p>}
        </div>
      </>}
    </div>
  )
}
