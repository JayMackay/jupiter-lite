import { api, fetchAudio, onServiceEvent, surface } from './client'

export type WakeStatus = 'off' | 'starting' | 'listening' | 'restarting' | 'unavailable'
export interface HeyState { status: WakeStatus; device: string | null; error: string | null; phase: 'idle' | 'heard' | 'thinking' | 'speaking'; said: string; reply: string; enabled: boolean; live: boolean }
let state: HeyState = { status: 'off', device: null, error: null, phase: 'idle', said: '', reply: '', enabled: false, live: false }
const listeners = new Set<() => void>()
const update = (patch: Partial<HeyState>) => { state = { ...state, ...patch }; listeners.forEach(listener => listener()) }
export const heyJupiter = {
  subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
  snapshot: () => state,
  async refresh() {
    const value = await api<{ wake: { status: WakeStatus; device: string | null; error: string | null }; wakeWord: boolean; live: boolean }>('/voice')
    update({ ...value.wake, enabled: value.wakeWord, live: value.live })
  },
  // The J button without an OpenAI key: listen for one request through the local listener.
  async listen() { update({ phase: 'heard', said: '', reply: '' }); await api('/voice/listen', {}) },
  // The J button pressed again: hush whatever is playing, stop listening, then say a saved goodbye.
  async stop() {
    silence()
    update({ phase: 'idle', said: '', reply: '' })
    const value = await api<{ url?: string | null; then?: string[]; pause?: number; text?: string }>('/voice/stop', {})
    if (surface !== 'workspace') return
    if (value.url) play(value.url, value.then, value.pause)
    else if (value.text && 'speechSynthesis' in window) { const line = new SpeechSynthesisUtterance(value.text); line.lang = 'en-GB'; speechSynthesis.speak(line) }
  },
  async set(on: boolean) {
    const value = await api<{ wake: { status: WakeStatus; device: string | null; error: string | null }; wakeWord: boolean }>('/voice/wake', { on })
    update({ ...value.wake, enabled: value.wakeWord })
  },
}

// One voice plays at a time; a new line replaces whatever is playing.
const audio = new Audio()
let playing: string | null = null
const queue: { audio: Promise<Blob>; gap: number }[] = []
let busy = false, generation = 0
// Clips are fetched straight away but played strictly one after another. A line can bring clips
// to follow it (a title such as "Sir."), each after a short pause so it doesn't sound stitched.
function play(url: string, then: string[] = [], pause = 0) {
  queue.push({ audio: fetchAudio(url), gap: 0 })
  for (const more of then) queue.push({ audio: fetchAudio(more), gap: pause })
  if (!busy) void next()
}
async function next() {
  const pending = queue.shift()
  if (!pending) { busy = false; void api('/voice/played', {}).catch(() => {}); if (state.phase === 'speaking') update({ phase: resume }); resume = 'idle'; return }
  busy = true
  const turn = generation
  try {
    const blob = await pending.audio
    if (pending.gap) await new Promise(resolve => setTimeout(resolve, pending.gap))
    if (turn !== generation) return
    if (playing) URL.revokeObjectURL(playing)
    playing = URL.createObjectURL(blob)
    audio.src = playing
    await listenToVoice()
    await audio.play()
  } catch { if (turn === generation) void next() }
}
// Stops the current clip and drops everything queued, so a new line never overlaps an old one.
function silence() {
  generation++; queue.length = 0; busy = false
  audio.pause()
  if ('speechSynthesis' in window) speechSynthesis.cancel()
}
// Whatever is playing, Jupiter is speaking: the orb's star follows the actual audio.
// Afterwards she goes back to what she was doing: still listening after "Yes, boss?", still thinking after "On it".
let resume: HeyState['phase'] = 'idle'
audio.addEventListener('playing', () => { if (state.phase !== 'speaking') { resume = state.phase === 'heard' || state.phase === 'thinking' ? state.phase : 'idle'; update({ phase: 'speaking' }) } })

// The loudness of the voice, for the star's pulse. The audio is only routed through Web Audio
// once a context is confirmed running, so a blocked context can never silence the voice.
let analyser: AnalyserNode | null = null, samples: Uint8Array<ArrayBuffer> | null = null, routing = false
async function listenToVoice() {
  if (analyser || routing || typeof AudioContext === 'undefined') return
  routing = true
  try {
    const context = new AudioContext()
    if (context.state !== 'running') await Promise.race([context.resume(), new Promise(resolve => setTimeout(resolve, 300))])
    if (context.state !== 'running') { void context.close(); return }
    const source = context.createMediaElementSource(audio), node = context.createAnalyser()
    node.fftSize = 512; source.connect(node); node.connect(context.destination)
    analyser = node; samples = new Uint8Array(new ArrayBuffer(node.fftSize))
  } catch { /* the star falls back to a gentle beat */ } finally { routing = false }
}
/** How loud Jupiter's voice is right now, 0 to 1 (null when it can't be measured). */
export function voiceLevel(): number | null {
  if (!analyser || !samples) return null
  if (audio.paused) return 0
  analyser.getByteTimeDomainData(samples)
  let sum = 0; for (const value of samples) { const x = (value - 128) / 128; sum += x * x }
  return Math.min(1, Math.sqrt(sum / samples.length) * 4.5)
}
function done() { void next() }
audio.addEventListener('ended', done)
audio.addEventListener('error', done)

onServiceEvent(event => {
  if (event.type === 'connected') void heyJupiter.refresh().catch(() => {})
  if (event.type === 'wake-state' && event.state && typeof event.state === 'object') update(event.state as unknown as Partial<HeyState>)
  if (event.type === 'wake-heard') update({ phase: 'heard', said: '', reply: '' })
  if (event.type === 'wake-idle') update({ phase: 'idle' })
  // Still in the conversation: listening for the next request without "Jupiter".
  if (event.type === 'wake-follow') update({ phase: 'heard', said: '' })
  if (event.type === 'wake-command') update({ phase: 'thinking', said: event.text || '' })
  if (event.type === 'voice-say') {
    if (event.kind === 'reply') update({ phase: 'speaking', reply: event.text || '' })
    else if (event.kind !== 'working' && event.kind !== 'wake') update({ phase: 'idle' })
    // Only the Workspace window speaks, so two windows never talk over each other.
    if (surface === 'workspace' && event.url) void play(event.url, event.then, event.pause)
    else if (surface === 'workspace' && event.kind === 'reply' && event.text && 'speechSynthesis' in window) {
      // No ElevenLabs credits or connection: Windows' own voice reads the reply instead.
      const line = new SpeechSynthesisUtterance(event.text.slice(0, 600)); line.lang = 'en-GB'; line.onstart = () => update({ phase: 'speaking' }); line.onend = done; speechSynthesis.speak(line)
    }
  }
})

// Settings' "Test the voice" plays a clip through the same player.
window.addEventListener('jupiter-play-clip', event => { const url = (event as CustomEvent<string>).detail; if (url) void play(url) })
