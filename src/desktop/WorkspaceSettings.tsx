import { useEffect, useState, useSyncExternalStore } from 'react'
import { heyJupiter } from './heyJupiter'
import { HeySettings } from './HeySettings'
import { api, onServiceEvent, OPEN_SETUP_EVENT, useDesktop } from './client'
import type { Settings } from './types'
import { Icon } from './Icons'
import DictationSettings from '../components/DictationSettings'
import { useDictation } from './useDictation'
import ThemePicker from '../components/ThemePicker'
import { isMac } from './platform'

type NativeSettings = { available: boolean; winKey: boolean; label?: string; error?: string }
export default function WorkspaceSettings({ onClose }: { onClose: () => void }) {
  const hey = useSyncExternalStore(heyJupiter.subscribe, heyJupiter.snapshot)
  const dictation = useDictation()
  const { settings, repo } = useDesktop()
  const [native, setNative] = useState<NativeSettings>({ available: false, winKey: false })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const refresh = () => api<NativeSettings>('/native/settings').then(setNative).catch(error => setError(String(error.message || error)))
    void refresh()
    return onServiceEvent(event => { if (event.type === 'native-settings') void refresh() })
  }, [])
  const change = async (patch: Partial<Settings>) => {
    setBusy(true); setError('')
    try { await api('/settings', patch) } catch (error) { setError(String(error instanceof Error ? error.message : error)) }
    finally { setBusy(false) }
  }
  const winKey = async (enabled: boolean) => {
    setBusy(true); setError('')
    try { setNative(await api<NativeSettings>('/native/settings', { winKey: enabled })) }
    catch (error) { setError(String(error instanceof Error ? error.message : error)) }
    finally { setBusy(false) }
  }
  return <div className="files-panel workspace-settings"><header><h2>Settings</h2><button className="desk-icon" onClick={onClose} aria-label="Close settings"><Icon name="close" size={17} /></button></header>
    <div className="settings-scroll"><section><h3>Appearance</h3><ThemePicker /><ThemePicker target="chat" /></section><section><h3>{isMac ? 'Shortcut' : 'Windows'}</h3><label className="setting-toggle"><span>{isMac ? 'Enable ' + (native.label || '⌃⌥⌘Space') : 'Enable Window Key'}<small>{isMac ? 'Show the combined workspace and Chats window from any app.' : 'Show the combined workspace and Chats window. Win shortcuts keep working; Ctrl+Esc opens Start.'}</small></span><input type="checkbox" checked={native.winKey} disabled={busy || !native.available} onChange={event => void winKey(event.target.checked)} /></label>{!native.available && <p>{native.error || 'Available in the Windows and macOS desktop app.'}</p>}</section>
    <HeySettings />
    <section><h3>Chats</h3><label>Default agent<select disabled={busy} value={settings.defaultAgent} onChange={event => void change({ defaultAgent: event.target.value as Settings['defaultAgent'] })}><option value="codex">Codex</option><option value="claude">Claude Code</option></select></label>
      <label>Terminal text size<select disabled={busy} value={settings.terminalFontSize || 13} onChange={event => void change({ terminalFontSize: Number(event.target.value) })}>{Array.from({ length: 15 }, (_, i) => i + 10).map(size => <option key={size} value={size}>{size} px</option>)}</select></label>
      <label>Terminal appearance<select disabled={busy} value={settings.terminalAppearance || 'original'} onChange={event => void change({ terminalAppearance: event.target.value as Settings['terminalAppearance'] })}><option value="original">Original CLI colors</option><option value="focus">Jupiter Focus · muted colors</option></select></label><p>Original preserves CLI colors, including added and removed lines. Focus uses muted colors. Your choice is saved for all chats and applies immediately without restarting them.</p>
      {isMac && <label className="setting-toggle"><span>Use Option as Meta key<small>Sends Meta shortcuts to the CLI. When off, Option types your keyboard layout's characters, such as @ or #.</small></span><input type="checkbox" checked={!!settings.terminalOptionMeta} disabled={busy} onChange={event => void change({ terminalOptionMeta: event.target.checked })} /></label>}
      <label className="setting-toggle"><span>Bypass CLI permissions<small>Default for new chats.</small></span><input type="checkbox" checked={settings.defaultBypass} disabled={busy} onChange={event => void change({ defaultBypass: event.target.checked })} /></label>
    </section><DictationSettings info={dictation.info} onChange={dictation.choose} /><section><h3>Jupiter</h3>{hey.live && <label>Live conversation voice<select disabled={busy} value={settings.voiceName || 'cedar'} onChange={event => void change({ voiceName: event.target.value })}><option value="cedar">Cedar</option><option value="marin">Marin</option></select></label>}<label>Thinking effort<select disabled={busy} value={settings.coordinatorEffort || 'medium'} onChange={event => void change({ coordinatorEffort: event.target.value as Settings['coordinatorEffort'] })}><option value="medium">Medium</option><option value="high">High</option></select></label><p>How hard Jupiter thinks before answering you. High is more thorough and a little slower.{hey.live ? ' The live conversation voice is the OpenAI voice used when you hold a back and forth conversation.' : ''}</p></section>
      <section><h3>Project</h3><p className="settings-repo">{repo}</p><p>Skills, knowledge and processes belong to this repository.</p><button type="button" className="desk-secondary" onClick={() => { window.dispatchEvent(new Event(OPEN_SETUP_EVENT)); onClose() }}>Run setup again</button></section>
      {error && <p className="desk-error-inline" role="alert">{error}</p>}
    </div></div>
}
