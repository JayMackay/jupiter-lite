import { useEffect, useState, useSyncExternalStore } from 'react'
import { api, reportError } from './client'
import { heyJupiter } from './heyJupiter'

type Usage = { tier: string; used: number; limit: number; resets: string | null; clips: number; replays: number; saved: number } | null
const STATUS: Record<string, string> = { listening: 'Listening for “Hey Jupiter”', starting: 'Starting…', restarting: 'Reconnecting to the microphone…', unavailable: 'Local Whisper is not installed', off: 'Off' }

/** Settings › Voice: the wake word switch, its microphone, and ElevenLabs credits. */
export function HeySettings() {
  const hey = useSyncExternalStore(heyJupiter.subscribe, heyJupiter.snapshot)
  const [usage, setUsage] = useState<Usage>(null)
  const [busy, setBusy] = useState(false)
  const [place, setPlace] = useState('London')
  const [placeNote, setPlaceNote] = useState('')
  useEffect(() => {
    let alive = true
    void heyJupiter.refresh().catch(() => {})
    api<{ usage: Usage }>('/voice').then(value => { if (alive) setUsage(value.usage) }).catch(() => {})
    api<{ place: string }>('/voice/weather').then(value => { if (alive) setPlace(value.place) }).catch(() => {})
    return () => { alive = false }
  }, [])
  const toggle = async (on: boolean) => { setBusy(true); try { await heyJupiter.set(on) } catch (error) { reportError(error) } finally { setBusy(false) } }
  const test = async () => { try { await api('/voice/say', { kind: 'wake' }).then(value => { const url = (value as { url?: string }).url; if (url) window.dispatchEvent(new CustomEvent('jupiter-play-clip', { detail: url })) }) } catch (error) { reportError(error) } }
  const savePlace = async () => {
    try { const value = await api<{ place: string }>('/voice/weather', { place }); setPlace(value.place); setPlaceNote(`Weather is for ${value.place}`) }
    catch (error) { setPlaceNote(error instanceof Error ? error.message : String(error)) }
  }
  return <section className="hey-settings"><h3>Voice</h3>
    <label className="desk-check"><input type="checkbox" disabled={busy} checked={hey.enabled} onChange={event => void toggle(event.target.checked)} /><span>Hey Jupiter<small>{STATUS[hey.status] || hey.status}{hey.device && hey.status === 'listening' ? ` · ${hey.device}` : ''}{hey.error ? ` · ${hey.error}` : ''}</small></span></label>
    <p className="desk-muted">Listens on this PC only. Audio is never recorded or sent; just the words after “Hey Jupiter” go to your assistant, and its reply is spoken by ElevenLabs.</p>
    {usage && <p className="desk-muted">ElevenLabs: {usage.used.toLocaleString()} of {usage.limit.toLocaleString()} credits used this month{usage.resets ? ` (resets ${new Date(usage.resets).toLocaleDateString([], { day: 'numeric', month: 'short' })})` : ''}. {usage.clips} saved clips, replayed {usage.replays} times, saving about {usage.saved.toLocaleString()} credits.</p>}
    <button type="button" className="desk-secondary" onClick={() => void test()}>Test the voice</button>
    <label className="hey-place" style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}><span>Weather location</span><input style={{ flex: 1, maxWidth: 220, height: 32, padding: '0 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,.16)', background: 'rgba(0,0,0,.25)', color: 'inherit', font: 'inherit' }} value={place} maxLength={80} aria-label="Weather location" onChange={event => { setPlace(event.target.value); setPlaceNote('') }} onKeyDown={event => { if (event.key === 'Enter') void savePlace() }} onBlur={() => void savePlace()} /></label>
    {placeNote && <p className="desk-muted" aria-live="polite">{placeNote}</p>}
  </section>
}
