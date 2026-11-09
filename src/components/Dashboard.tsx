import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import type { WorkspaceEntity } from '../types'
import type { ChatSession } from '../desktop/types'
import type { CoreController } from '../lib/neural-core.mjs'
import { api, isDesktop, reportError, selectChat, uploadImage, useDesktop } from '../desktop/client'
import { entityHash } from '../lib/route'
import NeuralCore from './NeuralCore'
import CapabilitiesView from './CapabilitiesView'
import BrainstormBoard from './BrainstormBoard'
import WorkBoard, { WorkBoardSummary } from './WorkBoard'
import TokenUsageView from './TokenUsage'
import { heyJupiter, voiceLevel } from '../desktop/heyJupiter'
import { api as serviceApi, onServiceEvent } from '../desktop/client'
import NewsView, { NewsSummary } from './NewsView'
import NewCard from './NewCard'
import { quickAdd } from '../lib/work'
import { parseTicketRequest } from '../../desktop/service/ticket-requests.mjs'
import { listBoards, quickIdea, type BoardInfo } from '../lib/board'
import { OPEN_WINDOW_EVENT, overTrash, takePendingWindow, type DashboardWindow } from '../lib/dashboard-open'
import { updateWorkspaceEntity } from '../lib/workspace'
import { categoryIcon } from '../lib/categories'
import { OPEN_EVENT, takeRequestedTab, type CapabilityTab } from '../lib/capabilities'
import { useExitTransition } from '../lib/useExitTransition'
import { navigateSurface } from '../lib/navigation'
import { dayPart, lastGreeting, pickGreeting, rememberGreeting } from '../lib/greeting'
import '../styles/dashboard.css'

type View = 'projects' | 'todo' | 'news' | 'notes' | 'agents' | 'connections' | 'capabilities' | 'archive' | 'tokens' | 'library'

// Remembered while the app runs, so returning from a search or a project restores the open panel.
let rememberedView: View | null = null
let rememberedTab: CapabilityTab = 'harness'

// The hero greeting no longer holds an editable "one thing today". What was saved before stays in
// knowledge/ (GET and POST /api/jupiter/home still serve it); the Dashboard just doesn't show it.
const titleFrom = (text: string) => text.replace(/[^\p{L}\p{N}\s'-]/gu, ' ').split(/\s+/).filter(Boolean).slice(0, 5).map(w => w[0].toUpperCase() + w.slice(1)).join(' ') || 'Jupiter Request'
const folderName = (cwd: string) => cwd.split(/[\\/]/).filter(Boolean).pop() || cwd
const lastTouched = (e: WorkspaceEntity) => e.updated ?? e.created
// 02/11/2026: UK dates everywhere on the dashboard.
// The Ask box's empty prompt: one of these, changing every few seconds.
const ASK_PHRASES = ['What are we doing today?', 'What’s on the agenda?', 'What are we working on?', 'What’s on your mind?', 'Where shall we start?', 'What needs doing next?']
const ukDate = (iso?: string) => { const [y, m, d] = String(iso || '').slice(0, 10).split('-'); return y && m && d ? `${d}/${m}/${y}` : '' }
// The greeting is said once per app launch, in the voice, and changes with the time of day.
let greeted = false
const setHash = (hash: string) => { window.location.hash = hash }
// Opening Brainstorm, To do, Projects or News: Jupiter says a short line (News reads the open tab's top story).
const GREET: Partial<Record<string, string>> = { notes: 'board', todo: 'todo', projects: 'projects', news: 'news' }
const newsTopic = () => { try { return localStorage.getItem('jupiter.news.topic') || 'ai' } catch { return 'ai' } }
const greet = (kind: string) => serviceApi<{ url?: string | null; text?: string; skipped?: boolean }>('/voice/greet', { view: kind, topic: newsTopic() }).then(value => {
  if (value.url) window.dispatchEvent(new CustomEvent('jupiter-play-clip', { detail: value.url }))
  return value
})
// Typed questions Jupiter answers out loud herself: weather, news, and mapping a project folder.
const SPOKEN = /\b(weather|forecast|umbrella|will it rain|need a coat|temperature|raining|rain (?:today|later|tomorrow)|is it (?:cold|hot|warm|sunny|wet)|how (?:cold|hot|warm) is it|snowing|news|headlines?|(?:top|biggest|main) stor(?:y|ies)|(?:what'?s|what is|anything) (?:happening|going on|new)|catch me up|latest (?:in|on|from))\b|^(?:jupiter,? )?(?:(?:can|could) you )?(?:scan|map|index|re-?scan|re-?map|re-?read|read .+ again|refresh|update .+ (?:project|map))\b/i

const ICONS: Record<string, ReactNode> = {
  projects: <><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /></>,
  todo: <><path d="M9 11l3 3 8-8" /><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9" /></>,
  news: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>,
  notes: <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z" />,
  agents: <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />,
  library: <><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><path d="M17.5 14v7M14 17.5h7" /></>,
  capabilities: <path d="M9 7V3M15 7V3M7 7h10v4a5 5 0 0 1-10 0zM12 16v5" />,
  connections: <><path d="M9 7V3M15 7V3M7 7h10v4a5 5 0 0 1-10 0zM12 16v5" /><path d="M4 21h16" /></>,
  archive: <><rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4" /></>,
  send: <path d="M5 12h14M13 6l6 6-6 6" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  plus: <path d="M12 5v14M5 12h14" />,
  tokens: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
}
const Icon = ({ name, size = 18 }: { name: string; size?: number }) => <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">{ICONS[name]}</svg>

const TITLES: Record<View, string> = { projects: 'Projects', todo: 'To do', news: 'News', notes: 'Brainstorm', agents: 'Agents and chats', connections: 'Capabilities', capabilities: 'Capabilities', archive: 'Archive', tokens: 'Token usage', library: 'All panels' }

interface DashboardProps {
  entities: WorkspaceEntity[]
  offline: boolean
  /** The classic card grid, shown in the expanded Projects view. */
  cards: ReactNode
}

export default function Dashboard({ entities, offline, cards }: DashboardProps) {
  const desktop = useDesktop()
  // True once the boards are listed (at once in the browser preview, which has none).
  const [loaded, setLoaded] = useState(!isDesktop)
  // A Plugins or MCP request made before the dashboard was showing (from the rail on another page).
  const [requestedAtMount] = useState(() => takeRequestedTab())
  const [windowAtMount] = useState(() => takePendingWindow())
  const [view, setViewState] = useState<View | null>(() => windowAtMount ? (rememberedView = windowAtMount === 'home' ? null : windowAtMount) : requestedAtMount ? (rememberedView = requestedAtMount === 'connections' ? 'connections' : 'capabilities') : rememberedView)
  const setView = useCallback((next: View | null) => { rememberedView = next; setViewState(next) }, [])
  const visibleView = useExitTransition(view)
  const [capTab, setCapTabState] = useState<CapabilityTab>(() => requestedAtMount && requestedAtMount !== 'connections' ? (rememberedTab = requestedAtMount) : rememberedTab)
  const setCapTab = useCallback((next: CapabilityTab) => { rememberedTab = next; setCapTabState(next) }, [])
  const [ask, setAsk] = useState('')
  const [focusEnd, setFocusEnd] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const [images, setImages] = useState<{ key: string; url: string; path?: string; name: string }[]>([])
  const [trash, setTrash] = useState<'idle' | 'armed' | 'open' | 'gulp'>('idle')
  const [boards, setBoards] = useState<BoardInfo[]>([])
  const [phraseStart] = useState(() => Math.floor(Math.random() * ASK_PHRASES.length))
  const [workKey, setWorkKey] = useState(0)
  const core = useRef<CoreController | null>(null)
  const root = useRef<HTMLDivElement>(null)

  const hey = useSyncExternalStore(heyJupiter.subscribe, heyJupiter.snapshot)
  // Reading (mapping a project, checking the weather or news): signals hop from node to node.
  const [reading, setReading] = useState<{ label: string; brief: boolean } | null>(null)
  useEffect(() => onServiceEvent(event => {
    if (event.type !== 'jupiter-reading') return
    const value = event as unknown as { on?: boolean; label?: string; brief?: boolean }
    setReading(value.on ? { label: value.label || 'Reading', brief: value.brief === true } : null)
  }), [])
  // A quick look (weather, news) ends when she starts to answer.
  useEffect(() => {
    if (!reading?.brief || hey.phase !== 'speaking') return
    const timer = window.setTimeout(() => setReading(null), 0)
    return () => window.clearTimeout(timer)
  }, [reading, hey.phase])

  const focusRef = useRef(0)
  useEffect(() => {
    const timer = setInterval(() => {
      const t = Date.now(); setNow(t)
      if (focusRef.current && t >= focusRef.current) { focusRef.current = 0; setFocusEnd(0) }
    }, 1000)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    if (!isDesktop || view) return
    let alive = true
    listBoards().then(list => { if (alive) { setBoards(list); setLoaded(true) } }).catch(() => { if (alive) setLoaded(true) }) // no list: the panel shows no boards
    return () => { alive = false }
  }, [view])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && view) setView(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [view, setView])

  // One greeting per visit: the seed is fixed while the Dashboard is open, so only a new day part
  // (for example morning to afternoon) or a new name from setup can change the words, never a clock tick.
  const owner = desktop.settings.nickname || desktop.settings.ownerName?.split(' ')[0] || ''
  const [seed] = useState(Math.random)
  const [lastLine] = useState(lastGreeting)
  const part = dayPart(new Date(now))
  const hello = useMemo(() => pickGreeting(part, owner, seed, lastLine), [part, owner, seed, lastLine])
  useEffect(() => { rememberGreeting(hello.id) }, [hello.id])

  const sessions = useMemo(() => desktop.sessions.filter(s => s.open).sort((a, b) => (b.lastOutputAt || b.updatedAt).localeCompare(a.lastOutputAt || a.updatedAt)), [desktop.sessions])
  const working = sessions.filter(s => s.activity === 'working').length
  // The orb: speaking while her voice plays, listening (blue), thinking (rainbow signals) while she,
  // a project map or any agent chat is working, and passive otherwise.
  const orbState = hey.phase === 'speaking' ? 'speaking' : hey.phase === 'heard' ? 'listening' : hey.phase === 'thinking' || reading || working > 0 ? 'thinking' : 'ambient'
  useEffect(() => { core.current?.setState(orbState) }, [orbState])
  useEffect(() => {
    if (orbState !== 'speaking') return
    let frame = 0
    const element = root.current
    const tick = (time: number) => {
      const level = voiceLevel()
      const value = level === null ? 0.45 + 0.4 * Math.abs(Math.sin(time / 140)) : level
      core.current?.setVoice(value)
      // The small star in an open window's title pulses with the same voice.
      element?.style.setProperty('--voice', value.toFixed(3))
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(frame); element?.style.setProperty('--voice', '0') }
  }, [orbState])
  const waiting = sessions.filter(s => s.attention || s.activity === 'waiting').length
  const projects = useMemo(() => [...entities].filter(e => e.status !== 'archived').sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || lastTouched(b).localeCompare(lastTouched(a))), [entities])
  const focusLeft = focusEnd ? Math.max(0, Math.round((focusEnd - now) / 1000)) : 0

  const quietOpen = useRef(false), greetedOpen = useRef(false)
  const open = useCallback((next: View | null) => {
    if (next) navigateSurface(next === 'capabilities' || next === 'connections' ? 'capabilities' : 'dashboard')
    setView(next); if (next) root.current?.scrollTo({ top: 0 })
    const kind = next ? GREET[next] : undefined
    if (kind && isDesktop && !quietOpen.current) { greetedOpen.current = true; void greet(kind).catch(() => {}) }
  }, [setView])
  // The rail's Plugins and MCP buttons open these pages from anywhere in the app.
  const openTab = useCallback((tab: CapabilityTab) => { if (tab === 'connections') open('connections'); else { setCapTab(tab); open('capabilities') } }, [open, setCapTab])
  useEffect(() => {
    const onOpen = (event: Event) => { takeRequestedTab(); openTab((event as CustomEvent<CapabilityTab>).detail) }
    window.addEventListener(OPEN_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_EVENT, onOpen)
  }, [openTab])
  const openProject = (entity: WorkspaceEntity) => { navigateSurface('dashboard'); setHash(entityHash(entity.id)) }
  const openChat = (session: ChatSession) => { selectChat(session.id); window.dispatchEvent(new Event('jupiter-show-chats')) }
  const toggleFocus = () => {
    if (focusEnd) { focusRef.current = 0; setFocusEnd(0) } else { const end = Date.now() + 25 * 60_000; focusRef.current = end; setFocusEnd(end) }
  }
  // "add …" from Ask Jupiter becomes a task in To do on the board you used last.
  const addTodo = (text: string) => { if (!isDesktop) return; quickAdd(text).then(() => setWorkKey(key => key + 1)).catch(reportError); core.current?.pulse(0.5) }
  // "create a feature ticket to …": the service saves one ticket and has Codex draft it; a failure shows as an error.
  const addTicket = (text: string) => {
    if (!isDesktop) { reportError(new Error('Tickets need the Jupiter desktop app.')); return }
    core.current?.pulse(0.5)
    api<{ status?: string; result?: unknown }>('/coordinator', { id: crypto.randomUUID(), text })
      .then(operation => { if (operation.status !== 'completed') reportError(new Error(String(operation.result || 'I could not save that ticket.'))); setWorkKey(key => key + 1) })
      .catch(reportError)
  }
  // Ideas from Ask Jupiter land on the board you used last.
  const addNote = (text: string) => { if (!isDesktop) return; quickIdea(text).then(() => listBoards()).then(setBoards).catch(reportError); core.current?.pulse(1) }
  const unarchive = async (entity: WorkspaceEntity) => { try { await updateWorkspaceEntity(entity.id, { status: 'active' }) } catch (error) { reportError(error) } }

  // Pasted or dropped screenshots are saved in inbox/attachments and handed to the chat.
  const attach = (files: File[]) => {
    for (const file of files.filter(item => item.type.startsWith('image/')).slice(0, 12)) {
      const key = crypto.randomUUID(), url = URL.createObjectURL(file)
      setImages(list => [...list, { key, url, name: file.name || 'Screenshot.png' }])
      uploadImage(file).then(saved => setImages(list => list.map(item => item.key === key ? { ...item, path: saved.path, name: saved.name } : item)))
        .catch(error => { setImages(list => list.filter(item => item.key !== key)); URL.revokeObjectURL(url); reportError(error) })
    }
  }
  const dropImage = (key: string) => setImages(list => { const gone = list.find(item => item.key === key); if (gone) URL.revokeObjectURL(gone.url); return list.filter(item => item.key !== key) })

  // The red trash can opens its lid while something is dragged over it.
  useEffect(() => {
    if (view !== 'projects') return
    const move = (event: Event) => { const { x, y } = (event as CustomEvent<{ x: number; y: number }>).detail; setTrash(overTrash(x, y) ? 'open' : 'armed') }
    const drop = (event: Event) => {
      const { x, y, id } = (event as CustomEvent<{ x: number; y: number; id?: string }>).detail
      if (!overTrash(x, y)) { setTrash('idle'); return }
      setTrash('gulp'); setTimeout(() => setTrash('idle'), 450)
      if (event.type === 'jupiter-card-drop' && id) {
        api(`/workspace/entities/${encodeURIComponent(id)}`, {}, 'DELETE').then(() => { window.dispatchEvent(new Event('jupiter-workspace-changed')) }).catch(reportError)
      }
    }
    const end = () => setTrash('idle')
    const events: [string, EventListener][] = [['jupiter-card-drag', move], ['jupiter-card-drop', drop], ['jupiter-card-drag-end', end]]
    for (const [name, handler] of events) window.addEventListener(name, handler)
    return () => { for (const [name, handler] of events) window.removeEventListener(name, handler) }
  }, [view])
  useEffect(() => {
    const onOpen = (event: Event) => { takePendingWindow(); const next = (event as CustomEvent<DashboardWindow>).detail; open(next === 'home' ? null : next) }
    window.addEventListener(OPEN_WINDOW_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_WINDOW_EVENT, onOpen)
  })

  async function startChat(text: string, attachments: string[] = []) {
    if (!isDesktop) { reportError(new Error('Agent chats need the Jupiter desktop app.')); return }
    try {
      const prompt = attachments.length ? `${text || 'Have a look at these screenshots.'}\n\nScreenshots: ${attachments.map(file => `"${file}"`).join(' ')}` : text
      const session = await api<ChatSession>('/sessions', { agent: desktop.settings.defaultAgent, name: titleFrom(text || 'Screenshots'), initialPrompt: prompt })
      openChat(session)
    } catch (error) { reportError(error) }
  }

  // Moving around the app by name, for the Ask bar and for "Hey Jupiter, …". True when handled.
  function navigateTo(raw: string): boolean {
    const text = raw.trim().replace(/^(?:can you|could you|please|jupiter)[,\s]+/i, '').replace(/[.!?]+$/, '')
    if (!text) return false
    if (/^(close|hide|dismiss)( (it|this|that|the window|the panel|everything))?$|^(go )?(home|back)$|^go back( home)?$/i.test(text)) { navigateSurface('dashboard'); setView(null); if (!/^#\/?$/.test(location.hash)) location.hash = '#/'; return true }
    if (/\bsettings\b/i.test(text)) { window.dispatchEvent(new CustomEvent('jupiter-open-rail', { detail: 'settings' })); return true }
    if (/\bfiles?\b|\bfolders?\b/i.test(text) && /^(open|show|bring|go)/i.test(text)) { window.dispatchEvent(new CustomEvent('jupiter-open-rail', { detail: 'files' })); return true }
    if (/\barchive/i.test(text)) { open('archive'); return true }
    const project = projects.find(e => text.toLowerCase().includes(e.title.toLowerCase().replace(/ [-·] .*/, '')))
    if (project && /open|show|go to|bring|take me/i.test(text)) { openProject(project); return true }
    if (/\b(mcp|mcps|connect(ed|ions?|ors?))\b/i.test(text)) { open('connections'); return true }
    // Short requests only, so a task such as "write a skill that…" still starts an agent chat.
    if (/\b(skills?|plugins?|capabilit\w*|harness|token bill)\b/i.test(text) && (text.length < 40 || /^(show|open|bring up|manage)\b/i.test(text))) { openTab('harness'); return true }
    const routes: [RegExp, View][] = [
      [/all panels|what can you show/i, 'library'],
      [/news|headline|what'?s happening/i, 'news'],
      [/token|usage|spend|cost|credits/i, 'tokens'],
      [/project|cards/i, 'projects'],
      [/to[- ]?do|my list|tasks|board|kanban|columns?/i, 'todo'],
      [/brainstorm|notes|ideas|whiteboard/i, 'notes'],
      [/agents?|chats?|claude|codex/i, 'agents'],
    ]
    const hit = /^(show|open|bring|go to|take me|what|how|list|pull up|let'?s)/i.test(text) || text.length < 30 ? routes.find(([re]) => re.test(text)) : undefined
    if (hit) { open(hit[1]); return true }
    return false
  }

  const navigate = useRef(navigateTo)
  useEffect(() => { navigate.current = navigateTo })
  // The assistant opened a view or a brainstorm board.
  useEffect(() => onServiceEvent(event => {
    const value = event as unknown as { type: string; view?: string; slug?: string }
    if (value.type === 'show-view' && value.view) {
      if (value.view === 'home') { setView(null); return }
      if (value.view === 'settings' || value.view === 'files') { window.dispatchEvent(new CustomEvent('jupiter-open-rail', { detail: value.view })); return }
      if (value.view === 'plugins') { openTab('harness'); return }
      quietOpen.current = true; open(value.view as View); quietOpen.current = false
    }
    if (value.type === 'show-work' && value.slug) {
      try { localStorage.setItem('jupiter.work.board', value.slug) } catch { /* optional */ }
      open('todo')
      setTimeout(() => window.dispatchEvent(new CustomEvent('jupiter-work-reload', { detail: { slug: value.slug } })), 50)
      window.dispatchEvent(new Event('jupiter-work-changed'))
    }
    if (value.type === 'show-board' && value.slug) {
      try { localStorage.setItem('jupiter.board', value.slug) } catch { /* optional */ }
      open('notes')
      window.dispatchEvent(new CustomEvent('jupiter-open-board', { detail: { slug: value.slug } }))
    }
  }), [open, openTab, setView])
  useEffect(() => onServiceEvent(event => {
    if (event.type !== 'jupiter-navigate' || !event.text) return
    greetedOpen.current = false
    if (!navigate.current(event.text)) void serviceApi('/voice/ask', { text: event.text }).catch(() => {})
    else if ((event as { voice?: boolean }).voice && !greetedOpen.current) void greet('opening').catch(() => {})
  }), [])

  function handleAsk(raw: string) {
    const text = raw.trim(); if (!text) return
    let m: RegExpMatchArray | null
    if (parseTicketRequest(text)) { addTicket(text); return }
    if ((m = text.match(/^(?:add|remind me to|todo:?|to-do:?)\s+(.+?)(?:\s+to (?:my|the) (?:list|to-?do))?$/i))) { addTodo(m[1]); return }
    if ((m = text.match(/^(?:note|idea|brainstorm)[:\s]+(.+)$/i))) { addNote(m[1]); return }
    if (/focus|pomodoro/i.test(text) && text.length < 40) { toggleFocus(); return }
    // Weather, news and project maps are answered by Jupiter herself, out loud.
    if (SPOKEN.test(text) && text.length < 140 && !/^(?:(?:can|could) you |please |jupiter,? )?(?:open|show|bring up|pull up|go to|take me)\b/i.test(text)) { void serviceApi('/voice/ask', { text }).catch(reportError); return }
    if (navigateTo(text)) return
    void startChat(text)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const box = root.current?.getBoundingClientRect(); if (!box) return
    const x = (event.clientX - box.left) / box.width * 2 - 1, y = (event.clientY - box.top) / box.height * 2 - 1
    root.current?.style.setProperty('--px', x.toFixed(3)); root.current?.style.setProperty('--py', y.toFixed(3))
    core.current?.setPointer(x, y)
    const glass = (event.target as HTMLElement).closest<HTMLElement>('.jh-glass')
    if (glass) { const r = glass.getBoundingClientRect(); glass.style.setProperty('--mx', `${event.clientX - r.left}px`); glass.style.setProperty('--my', `${event.clientY - r.top}px`) }
  }

  const onReady = useCallback((controller: CoreController | null) => {
    core.current = controller
    if (!controller || greeted) return
    greeted = true
    const kind = new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening'
    setTimeout(() => {
      // The spoken greeting still plays; its words are no longer shown under Ask Jupiter.
      if (!isDesktop) return
      serviceApi<{ url?: string | null; text?: string }>('/voice/say', { kind }).then(value => {
        if (value.url) window.dispatchEvent(new CustomEvent('jupiter-play-clip', { detail: value.url }))
      }).catch(() => {})
    }, 900)
  }, [])

  const submitAsk = (event: FormEvent) => {
    event.preventDefault()
    const ready = images.filter(item => item.path).map(item => item.path!)
    if (images.some(item => !item.path)) return // still saving a screenshot
    if (ready.length) { void startChat(ask.trim(), ready); images.forEach(item => URL.revokeObjectURL(item.url)); setImages([]) } else handleAsk(ask)
    setAsk('')
  }
  const time = new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  return (
    <div ref={root} className={`jupiter-home jh-orb-${orbState}${visibleView ? ' jh-focusing' : ''}${focusEnd ? ' jh-focus-mode' : ''}`} onPointerMove={onPointerMove}>
      <div className="jh-core-wrap" aria-hidden="true">
        <NeuralCore className="jh-core" radius={0.38} cy={0.34} dim={0.85} base="ambient" onReady={onReady} />
        <div className="jh-vignette" />
      </div>
      <div className="jh-inner">
        <div className="jh-topline">
          <div className="jh-brand">JUPITER<small>your workspace, awake</small></div>
          <div className="jh-chips">
            <button type="button" className="jh-chip jh-glass" onClick={() => open('agents')}>
              <i style={{ background: working ? 'var(--jh-ice)' : 'var(--jh-green)' }} />
              <span>Agents<small>{!isDesktop ? 'desktop app only' : sessions.length ? `${working} working · ${sessions.length} open${waiting ? ` · ${waiting} waiting` : ''}` : 'no chats open'}</small></span>
            </button>
            <button type="button" className={`jh-chip jh-glass${focusEnd ? ' jh-on' : ''}`} onClick={toggleFocus} aria-pressed={!!focusEnd}>
              <i style={{ background: 'var(--jh-ice)' }} />
              <span>{focusEnd ? `${String(Math.floor(focusLeft / 60)).padStart(2, '0')}:${String(focusLeft % 60).padStart(2, '0')}` : 'Focus'}<small>{focusEnd ? 'tap to stop' : 'start 25 min'}</small></span>
            </button>
            <div className="jh-chip jh-glass"><i style={{ background: 'var(--jh-ice-2)' }} /><span>{time}<small>{new Date(now).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}</small></span></div>
            <button type="button" className="jh-chip jh-glass jh-icon-chip" onClick={() => open('tokens')} aria-label="Token usage" title="Token usage"><Icon name="tokens" /></button>
            <button type="button" className="jh-chip jh-glass jh-icon-chip" onClick={() => open('library')} aria-label="All panels" title="All panels"><Icon name="library" /></button>
          </div>
        </div>

        <section className="jh-hero">
          <h1 className="jh-greeting">{hello.text}</h1>
          <form className="jh-ask jh-glass" onSubmit={submitAsk} onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault() }} onDrop={event => { const files = Array.from(event.dataTransfer.files); if (files.some(file => file.type.startsWith('image/'))) { event.preventDefault(); attach(files) } }}>
            <input value={ask} onChange={event => setAsk(event.target.value)} placeholder={ASK_PHRASES[(phraseStart + Math.floor(now / 8000)) % ASK_PHRASES.length]} onPaste={event => { const files = Array.from(event.clipboardData.files).filter(file => file.type.startsWith('image/')); if (files.length && isDesktop) { event.preventDefault(); attach(files) } }} aria-label="Ask Jupiter" />
            <button type="submit" className="jh-round jh-primary" aria-label="Send to Jupiter"><Icon name="send" /></button>
          </form>
          {images.length > 0 && <div className="jh-ask-images" aria-label="Screenshots for Jupiter">{images.map(item => <span key={item.key} className={`jh-ask-image${item.path ? '' : ' is-saving'}`} title={item.path ? `Saved in ${item.path}` : 'Saving in inbox…'}><img src={item.url} alt={item.name} /><button type="button" aria-label={`Remove ${item.name}`} onClick={() => dropImage(item.key)}>×</button></span>)}</div>}
        </section>

        <section className="jh-panels" aria-label="Home panels">
          <article className="jh-panel jh-glass" tabIndex={0} onClick={() => open('projects')} onKeyDown={event => { if (event.key === 'Enter') open('projects') }}>
            <header className="jh-ph"><span className="jh-ic"><Icon name="projects" /></span><h2>Projects</h2><small>{offline ? 'offline' : `${projects.length} active`}</small></header>
            {projects.slice(0, 4).map(e => (
              <div key={e.id} className="jh-row jh-link" onClick={event => { event.stopPropagation(); openProject(e) }} title={`Open ${e.title}`}>
                <span className="jh-dot" style={{ background: e.pinned ? 'var(--jh-ice)' : e.status === 'active' ? 'var(--jh-green)' : 'var(--jh-faint)' }} />
                <span className="jh-t">{e.title}</span><span className="jh-meta">{ukDate(lastTouched(e))}</span>
              </div>
            ))}
            {!projects.length && <p className="jh-empty">No Workspace cards yet.</p>}
          </article>
          <article className="jh-panel jh-glass" tabIndex={0} onClick={() => open('todo')} onKeyDown={event => { if (event.key === 'Enter') open('todo') }}>
            <header className="jh-ph"><span className="jh-ic"><Icon name="todo" /></span><h2>To do</h2></header>
            <WorkBoardSummary refreshKey={`${workKey}:${view}`} />
          </article>
          <article className="jh-panel jh-glass" tabIndex={0} onClick={() => open('news')} onKeyDown={event => { if (event.key === 'Enter') open('news') }}>
            <header className="jh-ph"><span className="jh-ic"><Icon name="news" /></span><h2>News</h2></header>
            <NewsSummary refresh={view} />
          </article>
          <article className="jh-panel jh-glass jh-quiet" tabIndex={0} onClick={() => open('notes')} onKeyDown={event => { if (event.key === 'Enter') open('notes') }}>
            <header className="jh-ph"><span className="jh-ic"><Icon name="notes" /></span><h2>Brainstorm</h2><small>{!boards.length ? 'no boards' : boards.length === 1 ? '1 board' : `${boards.length} boards`}</small></header>
            {/* The boards, newest first, like the Projects list; a row opens that board. */}
            {boards.slice(0, 4).map(board => (
              <div key={board.slug} className="jh-row jh-link" title={`Open ${board.title}`}
                onClick={event => { event.stopPropagation(); try { localStorage.setItem('jupiter.board', board.slug) } catch { /* optional */ } open('notes') }}>
                <span className="jh-dot" style={{ background: board.count ? 'var(--jh-ice)' : 'var(--jh-faint)' }} />
                <span className="jh-t">{board.title}</span><span className="jh-meta">{ukDate(board.updated || undefined)}</span>
              </div>
            ))}
            {loaded && !boards.length && <p className="jh-empty">Nothing on the board yet.</p>}
          </article>
        </section>
      </div>

      {visibleView && (
        <section className={`jh-focus jh-glass${!view ? ' is-exiting' : ''}`} aria-label={TITLES[visibleView]} inert={!view} aria-hidden={!view}>
          <div className="jh-focus-tools">
            {visibleView === 'projects' && isDesktop && <NewCard />}
            {visibleView === 'projects' && <span className={`jh-trash${trash === 'idle' ? '' : ` is-${trash === 'armed' ? 'armed' : trash}`}`} data-trash title="Drag a card here to throw it away" aria-label="Trash" role="img"><svg viewBox="0 0 24 24" aria-hidden="true"><g className="lid"><path d="M3 6h18M9 6V4h6v2" /></g><path d="M5.5 8.5l1 11.5h11l1-11.5M10 11.5v5.5M14 11.5v5.5" /></svg></span>}
            <button type="button" className="jh-round jh-close" onClick={() => setView(null)} aria-label="Close panel"><Icon name="close" /></button>
          </div>
          <header className="jh-ph">{orbState === 'speaking' || orbState === 'listening'
              ? <span className={`jh-ic jh-ic-star is-${orbState}`} aria-hidden="true"><i /></span>
              : <span className="jh-ic"><Icon name={visibleView} /></span>}<h2>{TITLES[visibleView]}</h2></header>
          <div className="jh-focus-body">
            {visibleView === 'library' && (
              <div className="jh-tiles">
                {(['projects', 'todo', 'notes', 'tokens', 'agents', 'connections', 'news'] as View[]).map(v => <button key={v} type="button" className="jh-tile" onClick={() => open(v)}><span className="jh-ic"><Icon name={v} /></span><b>{TITLES[v]}</b></button>)}
                <button type="button" className="jh-tile" onClick={() => open('capabilities')}><span className="jh-ic"><Icon name="capabilities" /></span><b>Capabilities</b><small>Harness, Skills, Memory, Tools, Token Bill</small></button>
                <p className="jh-note">Bugs, calendar, playtest feedback, mood board, snippets, docs and incoming assets arrive as their sources are connected.</p>
              </div>
            )}
            {visibleView === 'projects' && <div className="jh-cards">{cards}</div>}
            {visibleView === 'todo' && <WorkBoard projects={entities.filter(entity => entity.status !== 'archived').map(entity => ({ id: entity.id, title: entity.title }))} />}
            {visibleView === 'notes' && <BrainstormBoard onAdded={() => core.current?.pulse(1)} onSaved={() => { listBoards().then(setBoards).catch(() => {}) }} />}
            {visibleView === 'agents' && <>
              {!isDesktop && <p className="jh-empty">Agent chats are available in the Jupiter desktop app.</p>}
              {isDesktop && !sessions.length && <p className="jh-empty">No chats open. Ask Jupiter for a task to start one.</p>}
              {sessions.map(s => (
                <div key={s.id} className="jh-row jh-big">
                  <span className="jh-dot" style={{ background: s.attention || s.activity === 'waiting' ? 'var(--jh-amber)' : s.activity === 'working' ? 'var(--jh-ice)' : 'var(--jh-green)' }} />
                  <span className="jh-t"><b>{s.name}</b><small>{s.agent} · {folderName(s.cwd)} · {s.attention || s.activity === 'waiting' ? 'waiting for you' : s.activity}</small></span>
                  <button type="button" className="jh-mini" onClick={() => openChat(s)}>Open chat</button>
                </div>
              ))}
            </>}
            {(visibleView === 'capabilities' || visibleView === 'connections') && <CapabilitiesView initialTab={visibleView === 'connections' ? 'connections' : capTab} />}
            {visibleView === 'archive' && <>
              {entities.filter(entity => entity.status === 'archived').map(entity => (
                <div key={entity.id} className="jh-archive-row" data-archived={entity.id}>
                  <div><b>{entity.title}</b><small>{categoryIcon(entity.category)} {(entity.category || 'other').replace(/-/g, ' ')} · archived {entity.updated ?? entity.created}</small></div>
                  <button type="button" className="jh-mini jh-primary" onClick={() => void unarchive(entity)}>Unarchive</button>
                </div>
              ))}
              {!entities.some(entity => entity.status === 'archived') && <p className="jh-empty">Nothing archived. Archived cards keep their files and tabs, and come back here.</p>}
            </>}
            {visibleView === 'tokens' && <TokenUsageView />}
            {visibleView === 'news' && <NewsView />}
          </div>
        </section>
      )}
    </div>
  )
}
