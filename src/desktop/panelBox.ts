import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type RefObject } from 'react'

// Size of Jupiter's floating chat panel, and how far it has been dragged from its usual place
// beside the J launcher. The dock is anchored bottom left, so a bigger panel grows up and to the
// right with its bottom edge staying put; dragging uses the CSS translate property.
export interface PanelBox { width: number; height: number; x: number; y: number }
export interface Rect { left: number; top: number; bottom: number; width: number; height: number }
export interface View { width: number; height: number }
const EDGE = 8, MIN_W = 320, MIN_H = 240, MAX_W = 960
const clamp = (value: number, min: number, max: number) => Math.round(Math.min(Math.max(value, min), max))
const viewport = (): View => ({ width: window.innerWidth, height: window.innerHeight })

/** The top right grip moved by dx, dy: the corner follows the pointer (wider to the right, taller upwards) while the bottom left stays fixed, inside the window. */
export function resizeBox(start: PanelBox, rect: Rect, dx: number, dy: number, view: View = viewport()): PanelBox {
  return { ...start, width: clamp(start.width + dx, MIN_W, Math.min(MAX_W, view.width - rect.left - EDGE)), height: clamp(start.height - dy, MIN_H, rect.bottom - EDGE) }
}
/** The header dragged by dx, dy while unlocked, never past an edge of the window. */
export function moveBox(start: PanelBox, rect: Rect, dx: number, dy: number, view: View = viewport()): PanelBox {
  const left = clamp(rect.left + dx, EDGE, view.width - rect.width - EDGE)
  const top = clamp(rect.top + dy, EDGE, view.height - rect.height - EDGE)
  return { ...start, x: start.x + left - rect.left, y: start.y + top - rect.top }
}
/** The window changed size: shrink the panel if it must, then pull it back inside. */
export function fitBox(box: PanelBox, rect: Rect, view: View = viewport()): PanelBox {
  const width = clamp(box.width, MIN_W, Math.min(MAX_W, view.width - 2 * EDGE))
  const height = clamp(box.height, MIN_H, view.height - 2 * EDGE)
  const left = clamp(rect.left, EDGE, view.width - width - EDGE)
  const bottom = clamp(rect.bottom, height + EDGE, view.height - EDGE)
  return { width, height, x: box.x + left - rect.left, y: box.y + bottom - rect.bottom }
}

type Gesture = { kind: 'size' | 'move'; id: number; x: number; y: number; start: PanelBox; rect: Rect; frame: number }

/** null box = the default compact panel in its usual place. Locked by default. */
export function usePanelBox(panel: RefObject<HTMLElement | null>) {
  const [box, setBox] = useState<PanelBox | null>(null)
  const [locked, setLocked] = useState(true)
  const gesture = useRef<Gesture | null>(null)

  // Handlers are made once per box and lock state, so nothing reads the gesture ref while rendering.
  const begin = useCallback((kind: Gesture['kind'], event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || gesture.current) return
    if (kind === 'move' && (locked || (event.target as Element).closest('button'))) return
    const rect = panel.current?.getBoundingClientRect(); if (!rect) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    gesture.current = { kind, id: event.pointerId, x: event.clientX, y: event.clientY, rect, start: box || { width: rect.width, height: rect.height, x: 0, y: 0 }, frame: 0 }
  }, [box, locked, panel])
  const track = useCallback((event: PointerEvent<HTMLElement>) => {
    const now = gesture.current
    if (!now || now.id !== event.pointerId) return
    const dx = event.clientX - now.x, dy = event.clientY - now.y
    cancelAnimationFrame(now.frame)
    now.frame = requestAnimationFrame(() => setBox((now.kind === 'size' ? resizeBox : moveBox)(now.start, now.rect, dx, dy)))
  }, [])
  const end = useCallback((event: PointerEvent<HTMLElement>) => {
    const now = gesture.current
    if (!now || now.id !== event.pointerId) return
    gesture.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }, [])
  // The grip sits inside the header, so its events stop here instead of also reaching the header's drag handlers.
  const grip = useMemo(() => ({
    onPointerDown: (event: PointerEvent<HTMLElement>) => { event.stopPropagation(); begin('size', event) },
    onPointerMove: (event: PointerEvent<HTMLElement>) => { event.stopPropagation(); track(event) },
    onPointerUp: (event: PointerEvent<HTMLElement>) => { event.stopPropagation(); end(event) },
    onPointerCancel: (event: PointerEvent<HTMLElement>) => { event.stopPropagation(); end(event) },
  }), [begin, track, end])
  const header = useMemo(() => ({ onPointerDown: (event: PointerEvent<HTMLElement>) => begin('move', event), onPointerMove: track, onPointerUp: end, onPointerCancel: end }), [begin, track, end])
  // The window got smaller: keep the panel inside it.
  const sized = box !== null
  useEffect(() => {
    if (!sized) return
    const fit = () => { const rect = panel.current?.getBoundingClientRect(); if (rect) setBox(current => current && fitBox(current, rect)) }
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [sized, panel])
  useEffect(() => () => { if (gesture.current) cancelAnimationFrame(gesture.current.frame) }, [])

  const style: CSSProperties | undefined = box ? { width: box.width, height: box.height, maxWidth: 'none', translate: `${box.x}px ${box.y}px` } : undefined
  /** Back to the compact panel beside the launcher, locked. */
  const reset = useCallback(() => { gesture.current = null; setBox(null); setLocked(true) }, [])
  return { box, style, locked, setLocked, reset, grip, header }
}
