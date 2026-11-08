import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { api, clientId, onServiceEvent, reportError, surface, useDesktop } from './client'
import { liveVoice } from './live'
import { heyJupiter } from './heyJupiter'
import { Icon, Nose } from './Icons'
import JupiterComposer from './JupiterComposer'
import JupiterImages from './JupiterImages'
import { usePanelBox } from './panelBox'
import JupiterChats from './JupiterChats'
import type { Operation } from './types'

export default function VoiceDock() {
  const state = useDesktop()
  const live = useSyncExternalStore(liveVoice.subscribe, liveVoice.snapshot)
  const hey = useSyncExternalStore(heyJupiter.subscribe, heyJupiter.snapshot)
  const [panel, setPanel] = useState(false)
  const [tab, setTab] = useState<'conversation' | 'activity'>('conversation')
  const [sending, setSending] = useState(false)
  const bottom = useRef<HTMLDivElement>(null)
  // The panel can be resized by dragging its top right corner and, once unlocked, dragged by its header.
  // Closing it puts it back: compact, beside the launcher, locked. The conversation is kept.
  const panelRef = useRef<HTMLElement>(null)
  const box = usePanelBox(panelRef)
  const close = () => { setPanel(false); box.reset() }
  // The conversation shown: its saved messages plus any answers that arrived since, by ID.
  const chatId = state.jupiterChats.active
  const [history, setHistory] = useState<{ chat: string | null; items: Operation[] }>({ chat: null, items: [] })
  useEffect(() => {
    if (!chatId) return
    let current = true
    api<{ messages: Operation[] }>(`/jupiter/chats/${chatId}/messages`).then(value => { if (current) setHistory({ chat: chatId, items: value.messages }) }).catch(() => {})
    return () => { current = false }
  }, [chatId])
  const messages = useMemo(() => {
    const saved = history.chat === chatId ? history.items : []
    const recent = state.operations.filter(item => item.conversation === chatId && !saved.some(old => old.id === item.id))
    return [...saved, ...recent].sort((a, b) => a.at.localeCompare(b.at)).slice(-40)
  }, [history, chatId, state.operations])
  const active = ['live', 'connecting', 'closing'].includes(live.status)
  const otherVoice = state.voice.owner && state.voice.owner.clientId !== clientId
  useEffect(() => onServiceEvent(event => {
    if (event.type === 'disconnected') liveVoice.disconnect()
    if (event.type === 'notice' && event.notice) liveVoice.announce(`Verified terminal event: ${event.notice.text}. This does not by itself confirm that the project task succeeded.`)
    if (['session', 'navigate', 'connected'].includes(event.type)) liveVoice.context()
  }), [])
  useEffect(() => { if (panel) bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }) }, [live.captions, messages, panel])
  // The J is a toggle: the first press listens, the next one stops and says a saved goodbye.
  // A press while the last one is still being handled is ignored, so fast clicks can't stack up.
  const pressing = useRef(false)
  const heyOn = !hey.live && hey.phase !== 'idle'
  const run = (task: Promise<unknown>) => { pressing.current = true; void task.catch(reportError).finally(() => { pressing.current = false }) }
  const toggle = () => {
    if (pressing.current) return
    if (active) { liveVoice.stop(); run(heyJupiter.stop()) }
    else if (heyOn) run(heyJupiter.stop())
    else if (!hey.live) { setPanel(true); run(heyJupiter.listen()) }
    else { setPanel(true); liveVoice.start() }
  }
  async function send(text: string, images: string[]) {
    setSending(true)
    try {
      const result = await api<Operation>('/coordinator', { id: crypto.randomUUID(), text, images, selectedId: state.selectedId, conversationId: chatId })
      if (result.status !== 'completed') throw new Error(result.result || 'Jupiter could not complete this request.')
    } finally { setSending(false) }
  }
  const heyLine = hey.phase === 'heard' ? 'Listening…' : hey.phase === 'thinking' ? (hey.said ? `“${hey.said}”` : 'Thinking…') : hey.phase === 'speaking' ? hey.reply : ''
  return <div className={`voice-dock ${surface} ${active ? 'is-live' : ''} ${panel ? 'panel-open' : ''}${hey.status === 'listening' ? ' is-ears' : ''}${hey.phase !== 'idle' ? ` is-hey is-${hey.phase}` : ''}`}>
    {surface === 'workspace' && heyLine && <div className="hey-bubble" role="status" aria-live="polite"><i aria-hidden="true" /><span>{heyLine}</span></div>}
    <section ref={panelRef} className={`voice-panel${box.box ? ' is-sized' : ''}${box.locked ? '' : ' is-unlocked'}`} hidden={!panel} style={{ display: panel ? undefined : 'none', ...box.style }} aria-label="Jupiter conversation"><span className="voice-resize" role="separator" aria-label="Resize Jupiter window" title="Drag to resize" {...box.grip} /><header {...box.header}><span><Nose size={24} /><strong>Jupiter</strong><small>{live.status === 'live' ? 'Listening' : live.status === 'connecting' ? 'Connecting…' : live.status === 'closing' ? 'Finishing…' : state.coordinator === 'working' ? 'Working…' : 'At your service'}</small></span><span className="voice-panel-actions"><button className="desk-icon" title={box.locked ? 'Unlock to move the window' : 'Lock the window in place'} aria-label={box.locked ? 'Unlock window position' : 'Lock window position'} aria-pressed={!box.locked} onClick={() => box.setLocked(value => !value)}><Icon name={box.locked ? 'lock' : 'unlock'} size={15} /></button><button className="desk-icon" title="Hide conversation · voice stays as selected" onClick={close}><Icon name="close" size={16} /></button></span></header><div className="voice-tabs"><button className={tab === 'conversation' ? 'selected' : ''} onClick={() => setTab('conversation')}>Conversation</button><button className={tab === 'activity' ? 'selected' : ''} onClick={() => setTab('activity')}>Activity{state.notices.length > 0 && <span>{state.notices.length}</span>}</button></div><div className="voice-messages" aria-live="polite">
      {tab === 'conversation' ? <>{live.captions.length === 0 && messages.length === 0 && <div className="voice-welcome"><p>One conversation.<br />All your agents.</p><span>“Open my project chat.”<br />“Ask Claude to check the animation.”</span></div>}{messages.map(operation => <div key={operation.id} className="jupiter-exchange"><p className="caption user"><span>You</span>{operation.text}</p>{!!operation.images?.length && <JupiterImages paths={operation.images} />}<p className={`caption assistant ${operation.status !== 'completed' ? 'failed' : ''}`}><span>Jupiter</span>{operation.result || 'Working…'}</p></div>)}{!live.captions.length && state.voiceHistory.length > 0 && <details className="previous-voice"><summary>Previous voice conversation</summary>{state.voiceHistory[state.voiceHistory.length - 1].captions.map((caption, index) => <p key={index} className={`caption ${caption.role}`}><span>{caption.role === 'user' ? 'You' : 'Jupiter'}</span>{caption.text}</p>)}</details>}{live.captions.map((caption, index) => <p key={`${caption.start}-${index}`} className={`caption ${caption.role}`}><span>{caption.role === 'user' ? 'You' : 'Jupiter'}</span>{caption.text}</p>)}{(sending || state.coordinator === 'working') && <p className="voice-working"><i /><i /><i />Checking your workspace</p>}<div ref={bottom} /></> : <><JupiterChats list={state.jupiterChats} onOpen={() => setTab('conversation')} />{state.notices.length > 0 && <details className="jupiter-alerts"><summary>Agent alerts<span>{state.notices.length}</span></summary>{[...state.notices].reverse().map(notice => <button className="activity-item" key={notice.id} onClick={() => api(`/sessions/${notice.sessionId}/focus`, {}).catch(reportError)}><Icon name="bell" size={16} /><span><strong>{notice.name}</strong><small>{notice.text}</small></span><time>{new Date(notice.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></button>)}</details>}</>}
    </div>{live.error && <div className="voice-error" role="alert"><span>{live.error}</span><button className="desk-icon" aria-label="Dismiss voice error" onClick={() => liveVoice.dismissError()}><Icon name="close" size={14} /></button></div>}{!live.audible && <button className="desk-secondary" onClick={() => liveVoice.enablePlayback()}>Enable speaker audio</button>}{otherVoice && <div className="voice-hint">Voice is active in {state.voice.owner?.surface}. Use that window to stop it.</div>}<JupiterComposer connected={state.connected} sending={sending} onSend={send} /></section>
    <div className="voice-controls"><button className="voice-nose" title={active || heyOn ? 'Stop voice conversation' : 'Talk to Jupiter'} aria-label={active || heyOn ? 'Stop voice' : 'Start voice'} aria-pressed={active || heyOn} onClick={toggle} disabled={!!otherVoice || !state.connected || live.status === 'closing'}><Nose size={35} /><span>{live.status === 'live' ? 'Listening' : live.status === 'connecting' ? 'Connecting' : live.status === 'closing' ? 'Finishing' : 'Talk to Jupiter'}</span>{live.status === 'live' && <div className="voice-wave"><i /><i /><i /><i /></div>}</button><button className={`voice-caption-toggle ${panel ? 'selected' : ''}`} title={panel ? 'Hide conversation' : 'Conversation and activity'} onClick={() => { if (panel) close(); else setPanel(true) }} aria-label="Toggle conversation"><Icon name="chats" size={17} />{state.notices.some(notice => state.sessions.find(item => item.id === notice.sessionId)?.attention) && <i />}</button></div>
  </div>
}
