import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type WheelEvent as ReactWheelEvent } from 'react'
import { flushSync } from 'react-dom'
import { contentUrl, isDesktop, reportError, transcribeDesktopAudio, uploadImage, useDesktop } from '../desktop/client'
import { useDictation } from '../desktop/useDictation'
import VoiceInput from '../mobile/VoiceInput'
import '../styles/whiteboard.css'
import BoardMenu, { type BoardMenuRow } from './BoardMenu'
import { deleteBoard, FILLS, fillOf, listBoards, newId, readBoard, saveBoard, type BoardInfo, type Doc, type Fill, type Item, type ShapeKind, type Stroke } from '../lib/board'

type Tool = 'select' | 'note' | 'shape' | 'connect' | 'pen' | 'highlight' | 'eraser'
type View = { x: number; y: number; z: number }
const EMPTY: Doc = { title: 'Untitled board', items: [], links: [], strokes: [] }
const PENS = ['#ffd27a', '#7fe3ff', '#ff8a8a', '#6ff0b0', '#c3a6ff', '#ffffff']
const MARKERS = ['#fff35c', '#7dff9a', '#ff7ad9', '#7fd4ff']
const SIZES: [string, number][] = [['Fine', 2], ['Medium', 4], ['Sharpie', 9]]
const SHAPE_NAMES: Record<ShapeKind, string> = { rect: 'Rectangle', ellipse: 'Ellipse', diamond: 'Diamond', triangle: 'Triangle' }
const same = (a: Doc, b: Doc) => JSON.stringify(a) === JSON.stringify(b)
const centreOf = (item: Item) => ({ x: item.x + item.w / 2, y: item.y + item.h / 2 })
const near = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
  const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}
// While Jupiter is open, an unsaved board survives closing the window or switching boards.
const drafts = new Map<string, { doc: Doc; past: Doc[]; future: Doc[] }>()
let lastSlug: string | null = (() => { try { return localStorage.getItem('jupiter.board') } catch { return null } })()

// Greetings in the idea box, different each time the board opens.
function phrase(sessions: { name: string; open?: boolean }[]) {
  const hour = new Date().getHours()
  const open = sessions.filter(session => session.open)
  const options = [
    hour < 12 ? 'What have you got planned today, sir?' : hour < 18 ? 'What are we building this afternoon, sir?' : 'Late one tonight, sir? What’s on your mind?',
    'Welcome back, boss. Give me an idea and I’ll pin it.',
    'A fresh thought? I’m listening.',
    open[0] ? `Want to pick up ${open[0].name} where you left off?` : 'Nothing running. Perfect time for a fresh idea.',
    'Talk to me. What’s the next big thing?',
  ]
  return options[Math.floor(Math.random() * options.length)]
}

const PATHS: Record<string, ReactNode> = {
  select: <path d="M5 3l13 8-6 1.5L9 19z" />,
  note: <><path d="M5 4h14v11l-5 5H5z" /><path d="M14 20v-5h5" /></>,
  rect: <rect x="4" y="5" width="16" height="14" rx="2" />,
  ellipse: <ellipse cx="12" cy="12" rx="8.5" ry="7" />,
  diamond: <path d="M12 3l9 9-9 9-9-9z" />,
  triangle: <path d="M12 4l9 16H3z" />,
  fill: <><path d="M5 11l6-6 7 7-6 6a2 2 0 0 1-2.8 0L5 13.8a2 2 0 0 1 0-2.8z" /><path d="M4 12h14M19.5 15s1.5 2 1.5 3a1.5 1.5 0 0 1-3 0c0-1 1.5-3 1.5-3z" /></>,
  connect: <><circle cx="6" cy="6" r="2.6" /><circle cx="18" cy="18" r="2.6" /><path d="M8 8l8 8" /></>,
  pen: <path d="M4 20l4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20zM14 7l3 3" />,
  highlight: <><path d="M9 14l-3 3v3h3l3-3M9 14l7-9 3 3-7 9z" /><path d="M4 21h16" /></>,
  eraser: <><path d="M8 20l-4-4 10-10 6 6-8 8H8z" /><path d="M12 20h8M9 11l6 6" /></>,
  image: <><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="10" r="1.8" /><path d="M21 16l-5-5-8 8" /></>,
  undo: <path d="M9 7L4 12l5 5M4 12h11a5 5 0 0 1 0 10h-3" />,
  redo: <path d="M15 7l5 5-5 5M20 12H9a5 5 0 0 0 0 10h3" />,
  link: <><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>,
  open: <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />,
}
const Glyph = ({ name }: { name: string }) => <svg viewBox="0 0 24 24" aria-hidden="true">{PATHS[name]}</svg>

export default function BrainstormBoard({ onSaved, onAdded }: { onSaved?: (title: string, path: string) => void; onAdded?: () => void }) {
  const desktop = useDesktop()
  const { info: dictation } = useDictation()
  const [boards, setBoards] = useState<BoardInfo[]>([])
  const [slug, setSlug] = useState<string | null>(lastSlug)
  const [saved, setSaved] = useState<Doc>(EMPTY)
  const [doc, setDocState] = useState<Doc>(EMPTY)
  const [past, setPast] = useState<Doc[]>([])
  const [future, setFuture] = useState<Doc[]>([])
  const [loaded, setLoaded] = useState(false)
  const [tool, setTool] = useState<Tool>('select')
  const [shape, setShape] = useState<ShapeKind>('rect')
  const [pen, setPen] = useState({ color: PENS[0], size: 4 })
  const [marker, setMarker] = useState(MARKERS[0])
  const [popover, setPopover] = useState<'shape' | 'pen' | 'highlight' | 'fill' | null>(null)
  const [view, setView] = useState<View>({ x: 0, y: 0, z: 1 })
  const [selected, setSelected] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  // The letter that opened the editor when you just start typing on a selected note or shape.
  const [typed, setTyped] = useState('')
  const [from, setFrom] = useState<string | null>(null)
  const [stroke, setStroke] = useState<Stroke | null>(null)
  const [drawing, setDrawing] = useState<Item | null>(null)
  const [moving, setMoving] = useState<{ id: string; outside: boolean } | null>(null)
  const [text, setText] = useState('')
  const [status, setStatus] = useState('')
  const [greeting] = useState(() => phrase(desktop.sessions))
  const viewport = useRef<HTMLDivElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const gesture = useRef<{ kind: 'move' | 'pan' | 'resize' | 'erase' | 'connect'; id?: string; sx: number; sy: number; ox: number; oy: number; before: Doc; moved: boolean; ratio?: number; axis?: 'x' | 'y' | 'xy' } | null>(null)
  const [wire, setWire] = useState<{ from: string; x: number; y: number } | null>(null)
  const voiceIds = useRef(new Set<string>())
  const dirty = loaded && !same(doc, saved)

  // Every change that can be undone goes through commit(); `before` is the state to return to.
  const commit = useCallback((next: Doc | ((current: Doc) => Doc), before?: Doc) => {
    setDocState(current => {
      const value = typeof next === 'function' ? next(current) : next
      const origin = before || current
      if (same(value, origin)) return value
      setPast(list => [...list.slice(-99), origin]); setFuture([])
      return value
    })
  }, [])
  const undo = useCallback(() => {
    if (!past.length) return
    const previous = past[past.length - 1]
    setFuture(list => [doc, ...list].slice(0, 100)); setPast(list => list.slice(0, -1)); setDocState(previous)
  }, [past, doc])
  const redo = useCallback(() => {
    if (!future.length) return
    const [next, ...rest] = future
    setPast(list => [...list, doc].slice(-100)); setFuture(rest); setDocState(next)
  }, [future, doc])

  const open = useCallback(async (target: string | null) => {
    try {
      const list = isDesktop ? await listBoards() : []
      setBoards(list)
      const pick = target && list.some(board => board.slug === target) ? target : list[0]?.slug || null
      const board = pick ? await readBoard(pick) : { slug: null, ...EMPTY }
      const { slug: savedSlug, ...content } = board
      const draft = savedSlug ? drafts.get(savedSlug) : undefined
      setSlug(savedSlug); setSaved(content); setDocState(draft?.doc || content); setPast(draft?.past || []); setFuture(draft?.future || [])
      setSelected(null); setEditing(null); setFrom(null); setLoaded(true); setView({ x: 0, y: 0, z: 1 })
      lastSlug = savedSlug; try { if (savedSlug) localStorage.setItem('jupiter.board', savedSlug) } catch { /* optional */ }
    } catch (error) { reportError(error); setLoaded(true) }
  }, [])
  // The board to open: the one Jupiter asked for (stored just before), else the last one used.
  useEffect(() => { void Promise.resolve().then(() => open((() => { try { return localStorage.getItem('jupiter.board') } catch { return null } })() || lastSlug)) }, [open])
  // Jupiter opened or changed a board by voice: show it. Unsaved edits on that board are kept.
  const dirtyNow = useRef(false)
  useEffect(() => { dirtyNow.current = dirty })
  useEffect(() => {
    const onBoard = (event: Event) => {
      const wanted = (event as CustomEvent<{ slug: string }>).detail?.slug; if (!wanted) return
      if (wanted === slug && dirtyNow.current) { setStatus('Jupiter changed this board. Save or discard your edits to see it.'); return }
      void open(wanted)
    }
    window.addEventListener('jupiter-open-board', onBoard)
    return () => window.removeEventListener('jupiter-open-board', onBoard)
  }, [open, slug])
  // Keep the unsaved state of this board while you switch away.
  useEffect(() => { if (!loaded || !slug) return; if (same(doc, saved)) drafts.delete(slug); else drafts.set(slug, { doc, past, future }) }, [doc, saved, past, future, slug, loaded])

  // Resolves true once saved; a failure is reported and resolves false.
  const save = async () => {
    try {
      const result = await saveBoard(slug, doc)
      const { slug: savedSlug, ...content } = result
      if (slug) drafts.delete(slug)
      setSlug(savedSlug); setSaved(content); setDocState(content)
      lastSlug = savedSlug; try { localStorage.setItem('jupiter.board', savedSlug) } catch { /* optional */ }
      setBoards(await listBoards())
      const where = `knowledge/boards/${savedSlug}.json`
      setStatus(`Saved to ${where}`); onSaved?.(content.title, where)
      return true
    } catch (error) { reportError(error); return false }
  }
  const removeBoard = async () => {
    if (!slug) return
    try {
      await deleteBoard(slug)
      drafts.delete(slug)
      const left = await listBoards(); setBoards(left)
      if (left[0]) await open(left[0].slug); else newBoard()
      setStatus('Board deleted. It’s kept in knowledge/boards/.deleted if you need it back.')
    } catch (error) { reportError(error) }
  }
  const discard = () => { setDocState(saved); setPast([]); setFuture([]); if (slug) drafts.delete(slug); setStatus('Changes discarded') }
  // New session: an empty, untitled board, saved the first time you press Save.
  const newBoard = () => { setSlug(null); setSaved(EMPTY); setDocState(EMPTY); setPast([]); setFuture([]); setPopover(null); setSelected(null); setEditing(null); setView({ x: 0, y: 0, z: 1 }) }
  // The board menu rows: saved boards with their item counts; the open one shows its live title and
  // count, and an unsaved new board is listed first.
  const menuRows: BoardMenuRow[] = [
    ...(slug ? [] : [{ slug: '', title: doc.title, count: doc.items.length }]),
    ...boards.map(board => board.slug === slug ? { slug: board.slug, title: doc.title, count: doc.items.length } : { slug: board.slug, title: board.title, count: board.count }),
  ]

  // The board is an endless canvas you pan (drag empty space or scroll) and zoom (Ctrl + scroll).
  const toWorld = useCallback((clientX: number, clientY: number) => {
    const box = viewport.current!.getBoundingClientRect()
    return { x: (clientX - box.left - view.x) / view.z, y: (clientY - box.top - view.y) / view.z }
  }, [view])
  const centreSpot = () => { const box = viewport.current?.getBoundingClientRect(); return box ? toWorld(box.left + box.width / 2, box.top + box.height / 2) : { x: 200, y: 160 } }

  const addNote = (value: string, at = centreSpot(), edit = false) => {
    const notes = doc.items.filter(item => item.type === 'note').length
    const jitter = edit ? 0 : 1
    const item: Item = { id: newId(), type: 'note', text: value, tone: notes % 4, x: Math.round(at.x - (edit ? 20 : 110) + jitter * (Math.random() - 0.5) * 60), y: Math.round(at.y - (edit ? 20 : 45) + jitter * (Math.random() - 0.5) * 40), w: 220, h: 90 }
    commit(current => ({ ...current, items: [...current.items, item] }))
    setSelected(item.id); if (edit) setEditing(item.id)
    onAdded?.()
  }
  const addImage = async (file: File, at = centreSpot()) => {
    try {
      const savedFile = await uploadImage(file)
      const repo = desktop.repo.replace(/\\/g, '/').replace(/\/$/, '')
      const src = savedFile.path.replace(/\\/g, '/').replace(`${repo}/`, '')
      const local = URL.createObjectURL(file)
      const size = await new Promise<{ w: number; h: number }>(resolve => { const image = new Image(); image.onload = () => resolve({ w: image.naturalWidth, h: image.naturalHeight }); image.onerror = () => resolve({ w: 320, h: 200 }); image.src = local })
      URL.revokeObjectURL(local)
      const scale = Math.min(1, 360 / Math.max(size.w, 1))
      const item: Item = { id: newId(), type: 'image', src, name: savedFile.name, x: Math.round(at.x - size.w * scale / 2), y: Math.round(at.y - size.h * scale / 2), w: Math.round(size.w * scale), h: Math.round(size.h * scale) }
      commit(current => ({ ...current, items: [...current.items, item] })); setSelected(item.id)
    } catch (error) { reportError(error) }
  }
  const addLink = (url: string, at = centreSpot()) => {
    let host: string; try { host = new URL(url).hostname.replace(/^www\./, '') } catch { return }
    const item: Item = { id: newId(), type: 'link', url, text: host, x: Math.round(at.x - 130), y: Math.round(at.y - 32), w: 260, h: 64 }
    commit(current => ({ ...current, items: [...current.items, item] })); setSelected(item.id)
  }
  const remove = (ids: string[]) => commit(current => ({ ...current, strokes: current.strokes.filter(line => !line.on || !ids.includes(line.on)), items: current.items.filter(item => !ids.includes(item.id)), links: current.links.filter(link => !ids.includes(link.from) && !ids.includes(link.to)) }))
  const setItem = (id: string, patch: Partial<Item>) => commit(current => ({ ...current, items: current.items.map(item => item.id === id ? { ...item, ...patch } : item) }))

  // Paste anywhere on the board: images and GIFs, links, or text as a new note.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement
      if (target?.closest?.('input, textarea, [contenteditable=true]')) return
      if (!viewport.current?.isConnected) return
      const files = Array.from(event.clipboardData?.files || []).filter(file => file.type.startsWith('image/'))
      const pasted = event.clipboardData?.getData('text')?.trim() || ''
      if (files.length) { event.preventDefault(); const at = centreSpot(); files.forEach((file, index) => void addImage(file, { x: at.x + index * 30, y: at.y + index * 30 })) }
      else if (/^https?:\/\/\S+$/i.test(pasted)) { event.preventDefault(); addLink(pasted) }
      else if (pasted) { event.preventDefault(); addNote(pasted) }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  })
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = (event.target as HTMLElement)?.closest?.('input, textarea, [contenteditable=true]')
      const mod = event.ctrlKey || event.metaKey
      if (mod && event.key.toLowerCase() === 'z' && !typing) { event.preventDefault(); if (event.shiftKey) redo(); else undo() }
      else if (mod && event.key.toLowerCase() === 'y' && !typing) { event.preventDefault(); redo() }
      else if (mod && event.key.toLowerCase() === 's') { event.preventDefault(); if (dirty) void save() }
      else if ((event.key === 'Delete' || event.key === 'Backspace') && selected && !typing) { event.preventDefault(); remove([selected]); setSelected(null) }
      // A selected note or shape opens its editor when you press Enter or F2, or just start typing
      // (the letter is kept). Buttons and menus keep their own keys. flushSync mounts and focuses the
      // editor before the next key, so fast typing never loses a letter.
      else if (selected && editing === null && tool === 'select' && !typing && !mod && !event.altKey && !event.isComposing && viewport.current?.isConnected && !(event.target as HTMLElement)?.closest?.('button, select, a, [role=menuitem]')) {
        const item = doc.items.find(entry => entry.id === selected)
        const letter = event.key.length === 1 && event.key.trim() ? event.key : ''
        if (item && (item.type === 'note' || item.type === 'shape') && (letter || event.key === 'Enter' || event.key === 'F2')) { event.preventDefault(); flushSync(() => { setTyped(letter); setEditing(item.id) }) }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // The eraser removes pen and highlighter lines, connectors and shapes it touches.
  const eraseAt = (point: { x: number; y: number }, base: Doc): Doc => {
    const radius = 12 / view.z
    const hit = base.items.find(item => item.type === 'shape' && point.x >= item.x && point.x <= item.x + item.w && point.y >= item.y && point.y <= item.y + item.h)
    const byItem = new Map(base.items.map(item => [item.id, item]))
    const strokes = base.strokes.filter(line => { const card = line.on ? byItem.get(line.on) : null; if (line.on && !card) return false; if (card && card.id === hit?.id) return false; const px = point.x - (card?.x || 0), py = point.y - (card?.y || 0); return !line.points.some(([x, y], index) => index > 0 && near(px, py, line.points[index - 1][0], line.points[index - 1][1], x, y) < radius + line.size / 2) })
    const links = base.links.filter(link => { const a = byItem.get(link.from), b = byItem.get(link.to); if (!a || !b || link.from === hit?.id || link.to === hit?.id) return false; const p = centreOf(a), q = centreOf(b); return near(point.x, point.y, p.x, p.y, q.x, q.y) > radius })
    if (strokes.length === base.strokes.length && links.length === base.links.length && !hit) return base
    return { ...base, strokes, links, items: hit ? base.items.filter(item => item.id !== hit.id) : base.items }
  }
  const onCanvasDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.button !== 1) return
    if ((event.target as HTMLElement).closest('.jh-bd-item') && tool !== 'eraser' && tool !== 'pen' && tool !== 'highlight') return
    setPopover(null)
    const point = toWorld(event.clientX, event.clientY)
    event.currentTarget.setPointerCapture(event.pointerId)
    if (tool === 'pen' || tool === 'highlight') { setStroke({ id: newId(), kind: tool === 'pen' ? 'pen' : 'highlight', color: tool === 'pen' ? pen.color : marker, size: tool === 'pen' ? pen.size : 18, points: [[point.x, point.y]] }); return }
    if (tool === 'eraser') { gesture.current = { kind: 'erase', sx: event.clientX, sy: event.clientY, ox: 0, oy: 0, before: doc, moved: false }; setDocState(current => eraseAt(point, current)); return }
    if (tool === 'note') { event.preventDefault(); addNote('', point, true); setTool('select'); return }
    if (tool === 'shape') { setDrawing({ id: newId(), type: 'shape', shape, color: '#7fe3ff', text: '', x: point.x, y: point.y, w: 1, h: 1 }); return }
    setSelected(null); setFrom(null); setEditing(null)
    gesture.current = { kind: 'pan', sx: event.clientX, sy: event.clientY, ox: view.x, oy: view.y, before: doc, moved: false }
  }
  const onCanvasMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (stroke) { const point = toWorld(event.clientX, event.clientY); setStroke(current => current && { ...current, points: [...current.points, [point.x, point.y]] }); return }
    if (drawing) { const point = toWorld(event.clientX, event.clientY); setDrawing(current => current && { ...current, w: point.x - current.x, h: point.y - current.y }); return }
    const g = gesture.current; if (!g || !event.buttons) return
    if (g.kind === 'erase') { g.moved = true; const point = toWorld(event.clientX, event.clientY); setDocState(current => eraseAt(point, current)); return }
    if (g.kind === 'pan') { g.moved = true; setView(current => ({ ...current, x: g.ox + event.clientX - g.sx, y: g.oy + event.clientY - g.sy })) }
  }
  const onCanvasUp = () => {
    if (stroke) {
      const done = stroke; setStroke(null)
      if (done.points.length > 1) commit(current => {
        if (done.kind !== 'highlight') return { ...current, strokes: [...current.strokes, done] }
        // Mostly over one card? Then it highlights that card's text and moves with it.
        const card = [...current.items].reverse().find(item => done.points.filter(([x, y]) => x >= item.x && x <= item.x + item.w && y >= item.y && y <= item.y + item.h).length >= done.points.length * 0.6)
        const placed: Stroke = card ? { ...done, on: card.id, points: done.points.map(([x, y]) => [Math.round((x - card.x) * 10) / 10, Math.round((y - card.y) * 10) / 10]) } : done
        return { ...current, strokes: [...current.strokes, placed] }
      })
      return
    }
    if (drawing) {
      const box = { x: Math.min(drawing.x, drawing.x + drawing.w), y: Math.min(drawing.y, drawing.y + drawing.h), w: Math.max(60, Math.abs(drawing.w)), h: Math.max(60, Math.abs(drawing.h)) }
      const item = { ...drawing, ...box }; setDrawing(null)
      commit(current => ({ ...current, items: [...current.items, item] })); setSelected(item.id); setTool('select'); return
    }
    const g = gesture.current; gesture.current = null
    if (g?.kind === 'erase') commit(current => current, g.before)
  }
  const onWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (event.ctrlKey) {
      const box = viewport.current!.getBoundingClientRect(), mx = event.clientX - box.left, my = event.clientY - box.top
      setView(current => { const z = Math.min(2.5, Math.max(0.3, current.z * (event.deltaY < 0 ? 1.1 : 0.9))); return { z, x: mx - (mx - current.x) * (z / current.z), y: my - (my - current.y) * (z / current.z) } })
    } else setView(current => ({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY }))
  }

  // Items: drag to move; drag out of the window and let go to throw it away.
  const outsideWindow = (x: number, y: number) => { const box = viewport.current?.closest('.jh-focus')?.getBoundingClientRect(); return !!box && (x < box.left || x > box.right || y < box.top || y > box.bottom) }
  const onItemDown = (event: ReactPointerEvent<HTMLDivElement>, item: Item) => {
    if (editing === item.id || (event.target as HTMLElement).closest('a, button, .jh-bd-resize, .jh-bd-edge')) return
    if (tool === 'eraser') { if (item.type === 'shape') remove([item.id]); event.stopPropagation(); return }
    if (tool !== 'select' && tool !== 'connect') return
    event.stopPropagation()
    if (tool === 'connect') {
      const point = toWorld(event.clientX, event.clientY)
      setFrom(item.id); setWire({ from: item.id, x: point.x, y: point.y })
      gesture.current = { kind: 'connect', id: item.id, sx: event.clientX, sy: event.clientY, ox: 0, oy: 0, before: doc, moved: false }
      event.currentTarget.setPointerCapture(event.pointerId)
      return
    }
    setSelected(item.id)
    gesture.current = { kind: 'move', id: item.id, sx: event.clientX, sy: event.clientY, ox: item.x, oy: item.y, before: doc, moved: false }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const onItemMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current; if (!g || !g.id || !event.buttons || (g.kind !== 'move' && g.kind !== 'resize' && g.kind !== 'connect')) return
    if (g.kind === 'connect') { const point = toWorld(event.clientX, event.clientY); g.moved = true; setWire(current => current && { ...current, x: point.x, y: point.y }); return }
    const dx = (event.clientX - g.sx) / view.z, dy = (event.clientY - g.sy) / view.z
    if (!g.moved && Math.hypot(dx, dy) < 3) return
    g.moved = true
    if (g.kind === 'resize') setDocState(current => ({ ...current, items: current.items.map(item => {
      if (item.id !== g.id) return item
      // Images and shapes, like Word: the right edge sets the width, the bottom edge the height, the corner both;
      // hold Shift to keep the proportions (an image's own, a shape's current ones).
      // Notes only grow or shrink from their corner, always keeping their shape.
      const axis = g.axis || 'xy'
      let w = axis === 'y' ? g.ox : g.ox + dx, h = axis === 'x' ? g.oy : g.oy + dy
      if ((item.type === 'note' || event.shiftKey) && g.ratio) { if (axis === 'y') w = h / g.ratio; else h = w * g.ratio }
      w = Math.round(Math.max(60, w)); h = Math.round(Math.max(40, h))
      // A note given a height by hand keeps it, and its text scrolls inside; width alone leaves it growing.
      return { ...item, w, ...(item.type === 'note' && axis === 'x' && !item.sized ? {} : { h }), ...(item.type === 'note' && axis !== 'x' ? { sized: true } : {}) }
    }) }))
    else { setDocState(current => ({ ...current, items: current.items.map(item => item.id === g.id ? { ...item, x: Math.round(g.ox + dx), y: Math.round(g.oy + dy) } : item) })); setMoving({ id: g.id, outside: outsideWindow(event.clientX, event.clientY) }) }
  }
  const onItemUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current; if (!g || (g.kind !== 'move' && g.kind !== 'resize' && g.kind !== 'connect')) return
    gesture.current = null; setMoving(null)
    if (g.kind === 'connect') {
      setWire(null); setFrom(null)
      const a = g.id!
      const b = document.elementsFromPoint(event.clientX, event.clientY).map(element => element.closest<HTMLElement>('[data-item]')?.dataset.item).find(id => id && id !== a)
      if (b) commit(current => current.links.some(link => (link.from === a && link.to === b) || (link.from === b && link.to === a))
        ? { ...current, links: current.links.filter(link => !((link.from === a && link.to === b) || (link.from === b && link.to === a))) }
        : { ...current, links: [...current.links, { id: newId(), from: a, to: b }] })
      return
    }
    if (!g.moved || !g.id) return
    if (g.kind === 'move' && outsideWindow(event.clientX, event.clientY)) {
      const id = g.id
      commit({ ...g.before, strokes: g.before.strokes.filter(line => line.on !== id), items: g.before.items.filter(item => item.id !== id), links: g.before.links.filter(link => link.from !== id && link.to !== id) }, g.before)
      setSelected(null); setStatus('Thrown away. Undo brings it back.'); return
    }
    commit(current => current, g.before)
  }
  const onResizeDown = (event: ReactPointerEvent<HTMLSpanElement>, item: Item, axis: 'x' | 'y' | 'xy' = 'xy') => {
    event.stopPropagation()
    const card = event.currentTarget.parentElement as HTMLElement
    // A note that grows with its text starts from the height it shows now.
    const height = item.type === 'note' && !item.sized ? card.offsetHeight : item.h
    const picture = item.type === 'image' ? card.querySelector('img') : null
    const ratio = picture?.naturalWidth ? picture.naturalHeight / picture.naturalWidth : height / Math.max(1, item.w)
    gesture.current = { kind: 'resize', axis, id: item.id, sx: event.clientX, sy: event.clientY, ox: item.w, oy: height, before: doc, moved: false, ratio }
    ;(event.currentTarget.parentElement as HTMLElement).setPointerCapture(event.pointerId)
  }

  const byId = useMemo(() => new Map(doc.items.map(item => [item.id, item])), [doc.items])
  const strokePath = (line: Stroke) => line.points.map(([x, y], index) => `${index ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
  const pick = (next: Tool) => { setTool(current => current === next && next !== 'select' ? 'select' : next); setFrom(null); setPopover(null) }
  const toolButton = (name: Tool, label: string, icon: string = name, menu?: 'shape' | 'pen' | 'highlight') => (
    <button type="button" className="jh-bd-tool" aria-pressed={tool === name} title={menu ? `${label} (click again for options)` : label} aria-label={label}
      onClick={() => { if (menu && tool === name) setPopover(current => current === menu ? null : menu); else { pick(name); if (menu) setPopover(menu) } }}><Glyph name={icon} /><span>{label}</span></button>
  )
  // The fill bucket colours the selected note or shape (the board selects one item at a time).
  const fillable = selected ? doc.items.find(item => item.id === selected && (item.type === 'note' || item.type === 'shape')) || null : null
  const shown = drawing ? [...doc.items, { ...drawing, x: Math.min(drawing.x, drawing.x + drawing.w), y: Math.min(drawing.y, drawing.y + drawing.h), w: Math.abs(drawing.w), h: Math.abs(drawing.h) }] : doc.items

  // A note's or shape's text: the editor while it is being edited, otherwise the words themselves.
  const textField = (item: Item) => editing === item.id
    ? <textarea autoFocus className="jh-bd-edit" defaultValue={`${item.text || ''}${typed}`} placeholder="Type here" aria-label={item.type === 'note' ? 'Idea text' : 'Shape label'} onPointerDown={event => event.stopPropagation()}
        onFocus={event => { const field = event.currentTarget; field.setSelectionRange(field.value.length, field.value.length) }}
        onBlur={event => { const value = event.target.value.trim(); setEditing(null); setTyped(''); if (item.type === 'note' && !value) remove([item.id]); else if (value !== (item.text || '')) setItem(item.id, { text: value }) }}
        // Escape only leaves the editor; without stopPropagation it would also close the whole Brainstorm window.
        onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.blur() } if (event.key === 'Escape') { event.stopPropagation(); event.currentTarget.blur() } }} />
    : <span className="jh-bd-text" onWheel={event => { const text = event.currentTarget; if (text.scrollHeight > text.clientHeight + 1) event.stopPropagation() }}>{item.text}</span>

  return (
    <div className={`jh-bd-root jh-bd-tool-${tool}`}>
      <div className="jh-bd-top">
        <div className="jh-bd-name">
          <BoardMenu rows={menuRows} current={slug ?? ''} title={doc.title} newLabel="New session" onPick={target => void open(target)} onNew={newBoard}
            onSave={() => save().then(ok => { if (!ok) throw new Error('Not saved') })} unsaved={dirty} onDiscard={discard} onDelete={slug ? () => void removeBoard() : undefined} />
          <input value={doc.title} onChange={event => { const title = event.target.value; setDocState(current => ({ ...current, title })) }} aria-label="Board title" placeholder="Name this board" maxLength={120} />
          {dirty && <small className="jh-bd-dirty" title="Save from the board menu">Unsaved</small>}
        </div>
        <div className="jh-bd-tools" role="toolbar" aria-label="Board tools">
          {toolButton('select', 'Select')}
          {toolButton('note', 'Note')}
          {toolButton('shape', 'Shape', shape, 'shape')}
          {toolButton('connect', 'Connect')}
          {toolButton('pen', 'Pen', 'pen', 'pen')}
          {toolButton('highlight', 'Highlight', 'highlight', 'highlight')}
          {toolButton('eraser', 'Eraser')}
          <button type="button" className="jh-bd-tool" title={fillable ? 'Fill colour' : 'Select a note or shape to colour it'} aria-label="Fill colour" aria-expanded={popover === 'fill'} disabled={!fillable} onClick={() => setPopover(current => current === 'fill' ? null : 'fill')}><Glyph name="fill" /><span>Fill</span></button>
          <button type="button" className="jh-bd-tool" title="Image" aria-label="Add image" onClick={() => picker.current?.click()}><Glyph name="image" /><span>Image</span></button>
          <i className="jh-bd-sep" />
          <button type="button" className="jh-bd-tool" title="Undo (Ctrl+Z)" aria-label="Undo" disabled={!past.length} onClick={undo}><Glyph name="undo" /><span>Undo</span></button>
          <button type="button" className="jh-bd-tool" title="Redo (Ctrl+Y)" aria-label="Redo" disabled={!future.length} onClick={redo}><Glyph name="redo" /><span>Redo</span></button>
          {popover === 'shape' && <div className="jh-bd-pop jh-bd-shapes" role="menu">{(['rect', 'ellipse', 'diamond', 'triangle'] as ShapeKind[]).map(kind => <button key={kind} type="button" role="menuitem" aria-pressed={shape === kind} onClick={() => { setShape(kind); setTool('shape'); setPopover(null) }}><Glyph name={kind} />{SHAPE_NAMES[kind]}</button>)}</div>}
          {popover === 'pen' && <div className="jh-bd-pop jh-bd-pens" aria-label="Pen options">
            <div className="jh-bd-swatches">{PENS.map(color => <button key={color} type="button" aria-label={`Pen colour ${color}`} aria-pressed={pen.color === color} style={{ background: color }} onClick={() => setPen(current => ({ ...current, color }))} />)}</div>
            <div className="jh-bd-sizes">{SIZES.map(([label, size]) => <button key={label} type="button" aria-pressed={pen.size === size} onClick={() => setPen(current => ({ ...current, size }))}><i style={{ height: size, background: pen.color }} />{label}</button>)}</div>
          </div>}
          {popover === 'fill' && fillable && <div className="jh-bd-pop jh-bd-fills" aria-label="Fill colours">
            <div className="jh-bd-swatches">{[...(fillable.type === 'shape' ? [{ id: 'none' as Fill, label: 'No fill' }] : []), ...FILLS].map(entry => <button key={entry.id} type="button" className={`jh-bd-swatch jh-bd-fill-${entry.id}`} title={entry.label} aria-label={`Fill ${entry.label}`} aria-pressed={fillOf(fillable) === entry.id} onClick={() => setItem(fillable.id, { fill: entry.id })} />)}</div>
          </div>}
          {popover === 'highlight' && <div className="jh-bd-pop jh-bd-pens" aria-label="Highlighter options"><div className="jh-bd-swatches">{MARKERS.map(color => <button key={color} type="button" aria-label={`Highlighter colour ${color}`} aria-pressed={marker === color} style={{ background: color }} onClick={() => setMarker(color)} />)}</div></div>}
        </div>
      </div>
      <input ref={picker} type="file" hidden accept="image/png,image/jpeg,image/gif,image/webp,image/bmp" multiple onChange={event => { Array.from(event.target.files || []).forEach(file => void addImage(file)); event.target.value = '' }} />

      <div ref={viewport} className="jh-bd-canvas" style={{ backgroundPosition: `${view.x}px ${view.y}px`, backgroundSize: `${26 * view.z}px ${26 * view.z}px` }}
        onPointerDown={onCanvasDown} onPointerMove={onCanvasMove} onPointerUp={onCanvasUp} onWheel={onWheel} aria-label="Brainstorm board"
        onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault() }}
        onDrop={event => { const files = Array.from(event.dataTransfer.files).filter(file => file.type.startsWith('image/')); if (files.length) { event.preventDefault(); const at = toWorld(event.clientX, event.clientY); files.forEach(file => void addImage(file, at)) } }}>
        <div className="jh-bd-world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}>
          <svg className="jh-bd-ink" width="1" height="1" aria-hidden="true">
            {doc.links.map(link => { const a = byId.get(link.from), b = byId.get(link.to); if (!a || !b) return null; const p = centreOf(a), q = centreOf(b); return <line key={link.id} className="jh-bd-wire" x1={p.x} y1={p.y} x2={q.x} y2={q.y} /> })}
            {wire && byId.get(wire.from) && (() => { const p = centreOf(byId.get(wire.from)!); return <line className="jh-bd-wire is-live" x1={p.x} y1={p.y} x2={wire.x} y2={wire.y} /> })()}
            {[...doc.strokes, ...(stroke?.kind === 'pen' ? [stroke] : [])].filter(line => line.kind === 'pen' && !line.on).map(line => <path key={line.id} className="jh-bd-stroke is-pen" d={strokePath(line)} stroke={line.color} strokeWidth={line.size} />)}
          </svg>
          {shown.map(item => (
            <div key={item.id} data-item={item.id} data-type={item.type}
              className={`jh-bd-item jh-bd-${item.type}${item.type === 'note' || item.type === 'shape' ? ` jh-bd-fill-${fillOf(item)}` : ''}${item.type === 'note' && item.sized ? ' is-sized' : ''}${item.shape ? ` is-${item.shape}` : ''}${selected === item.id ? ' is-selected' : ''}${from === item.id ? ' is-from' : ''}${moving?.id === item.id ? ` is-moving${moving.outside ? ' is-leaving' : ''}` : ''}`}
              style={{ left: item.x, top: item.y, width: item.w, ...(item.type === 'note' && !item.sized ? { minHeight: item.h } : { height: item.h }) }}
              onPointerDown={event => onItemDown(event, item)} onPointerMove={onItemMove} onPointerUp={onItemUp}
              onDoubleClick={() => { if (item.type === 'note' || item.type === 'shape') { setTyped(''); setEditing(item.id) } }}>
              {item.type === 'shape' && <svg className="jh-bd-shape-art" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">{item.shape === 'ellipse' ? <ellipse cx="50" cy="50" rx="48" ry="48" /> : item.shape === 'diamond' ? <path d="M50 2L98 50 50 98 2 50z" /> : item.shape === 'triangle' ? <path d="M50 3L97 97H3z" /> : <rect x="1.5" y="1.5" width="97" height="97" rx="6" />}</svg>}
              {item.type === 'note' && textField(item)}
              {item.type === 'shape' && <div className="jh-bd-shape-body">{textField(item)}</div>}
              {item.type === 'image' && item.src && <img src={contentUrl(`/${item.src}`)} alt={item.name || 'Pasted image'} draggable={false} />}
              {item.type === 'link' && <><span className="jh-bd-link-icon"><Glyph name="link" /></span><span className="jh-bd-link-text"><b>{item.text}</b><small>{item.url}</small></span><a href={item.url} target="_blank" rel="noreferrer" aria-label={`Open ${item.text}`} className="jh-bd-open"><Glyph name="open" /></a></>}
              {doc.strokes.some(line => line.on === item.id) && <svg className="jh-bd-item-ink" width="1" height="1" aria-hidden="true">{doc.strokes.filter(line => line.on === item.id).map(line => <path key={line.id} className="jh-bd-stroke is-highlight" d={strokePath(line)} stroke={line.color} strokeWidth={line.size} />)}</svg>}
              {selected === item.id && <>
                {item.type !== 'note' && <span className="jh-bd-edge is-x" onPointerDown={event => onResizeDown(event, item, 'x')} aria-hidden="true" />}
                {item.type !== 'note' && <span className="jh-bd-edge is-y" onPointerDown={event => onResizeDown(event, item, 'y')} aria-hidden="true" />}
                <span className="jh-bd-resize" onPointerDown={event => onResizeDown(event, item)} aria-hidden="true" />
              </>}
            </div>
          ))}
          <svg className="jh-bd-ink jh-bd-ink-top" width="1" height="1" aria-hidden="true">
            {[...doc.strokes, ...(stroke?.kind === 'highlight' ? [stroke] : [])].filter(line => line.kind === 'highlight' && !line.on).map(line => <path key={line.id} className="jh-bd-stroke is-highlight" d={strokePath(line)} stroke={line.color} strokeWidth={line.size} />)}
          </svg>
        </div>
        {loaded && !doc.items.length && !doc.strokes.length && <p className="jh-bd-empty">Paste an image or link, pick a tool above, or tell me an idea below.</p>}
        {moving?.outside && <p className="jh-bd-leaving">Let go to throw it away</p>}
        {tool === 'connect' && <p className="jh-bd-hint">{wire ? 'Let go on the item to connect to' : 'Drag from one item to another to connect them'}</p>}
      </div>

      <div className="jh-bd-bar">
        <form className="jh-bd-input" onSubmit={event => { event.preventDefault(); const idea = text.replace(/\s+/g, ' ').trim(); if (idea) { addNote(idea); setText('') } }}>
          <input value={text} onChange={event => setText(event.target.value)} placeholder={greeting} aria-label="New idea" />
          {isDesktop && <span className="jh-bd-mic"><VoiceInput id="brainstorm" connected={desktop.connected} disabled={false} config={dictation} transcriber={transcribeDesktopAudio} onBusy={() => {}} onText={(spoken, recordingId) => { if (voiceIds.current.has(recordingId)) return; voiceIds.current.add(recordingId); setText(current => current ? `${current} ${spoken}` : spoken) }} /></span>}
        </form>
      </div>
      {status && <p className="jh-bd-status" role="status" key={status} onAnimationEnd={() => setStatus('')}>{status}</p>}
    </div>
  )
}
