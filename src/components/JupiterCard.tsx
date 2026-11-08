import { useRef } from 'react'
import type { WorkspaceEntity } from '../types'
import { entityHash } from '../lib/route'
import { categoryIcon } from '../lib/categories'
import { contentUrl, isDesktop } from '../desktop/client'
import { EntityStatusButton } from './EntityControls'
import { overTrash } from '../lib/dashboard-open'

/**
 * The design-system card: glass surface over the aura, gradient edge
 * (pink→purple; amber when pinned), glow + lift on hover. Building
 * block of the home grid; mirrored as `.jupiter-card` in
 * scripts/shared/report_style.py for generated reports.
 */
export default function JupiterCard({ entity }: { entity: WorkspaceEntity }) {
  const gesture = useRef<{ x: number; y: number; moved: boolean; ghost?: HTMLElement; dx?: number; dy?: number } | null>(null)
  // The real card follows the pointer while it's dragged, so you can see what you're moving.
  const startGhost = (anchor: HTMLElement, x: number, y: number) => {
    const drag = gesture.current; if (!drag) return
    const box = anchor.getBoundingClientRect()
    const ghost = anchor.cloneNode(true) as HTMLElement
    ghost.classList.add('card-drag-ghost'); ghost.removeAttribute('href'); ghost.style.width = `${box.width}px`; ghost.style.height = `${box.height}px`
    // The copy sits on its own layer above every window (so nothing clips it), wrapped in the
    // card grid's class so it keeps the card's own look.
    const layer = document.createElement('div'); layer.className = 'home card-drag-layer'
    layer.appendChild(ghost); (anchor.closest('.jupiter-home') || document.body).appendChild(layer)
    drag.dx = x - box.left; drag.dy = y - box.top; drag.ghost = ghost
    ghost.style.transformOrigin = `${drag.dx}px ${drag.dy}px`
    ghost.style.translate = `${box.left}px ${box.top}px`
    anchor.parentElement?.classList.add('is-dragging')
  }
  const moveGhost = (x: number, y: number) => { const drag = gesture.current; if (!drag?.ghost) return; drag.ghost.style.translate = `${x - (drag.dx || 0)}px ${y - (drag.dy || 0)}px`; drag.ghost.classList.toggle('is-over-trash', overTrash(x, y)) }
  const endGhost = (anchor: HTMLElement | null, trashed = false) => {
    const ghost = gesture.current?.ghost; anchor?.parentElement?.classList.remove('is-dragging')
    if (!ghost) return
    if (gesture.current) gesture.current.ghost = undefined
    const layer = ghost.parentElement
    if (trashed) { ghost.classList.add('is-trashing'); setTimeout(() => layer?.remove(), 380) } else layer?.remove()
  }
  const steps = entity.steps.length
  return (
    <div className="entity-card-wrap" data-card={entity.id}>
    <a
      draggable={false}
      // Pinned cards stay put: only Unpin in the card menu moves them.
      onPointerDown={event => { if (isDesktop && event.button === 0 && !entity.pinned) gesture.current = { x: event.clientX, y: event.clientY, moved: false } }}
      onPointerMove={event => {
        const drag = gesture.current
        if (!drag || !event.buttons) return
        if (drag.moved) moveGhost(event.clientX, event.clientY)
        if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 6) { if (!drag.moved) startGhost(event.currentTarget, event.clientX, event.clientY); drag.moved = true; event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault(); window.dispatchEvent(new CustomEvent('jupiter-card-drag', { detail: { id: entity.id, x: event.clientX, y: event.clientY } })) }
      }}
      onPointerUp={event => { const drag = gesture.current; if (drag?.moved) { event.preventDefault(); endGhost(event.currentTarget, overTrash(event.clientX, event.clientY)); window.dispatchEvent(new CustomEvent('jupiter-card-drop', { detail: { id: entity.id, x: event.clientX, y: event.clientY } })); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) } }}
      onPointerCancel={event => { endGhost(event.currentTarget); gesture.current = null; window.dispatchEvent(new Event('jupiter-card-drag-end')) }}
      onClick={event => { if (gesture.current?.moved) event.preventDefault(); gesture.current = null }}
      onLostPointerCapture={event => { endGhost(event.currentTarget); window.dispatchEvent(new Event('jupiter-card-drag-end')) }}
      onDragStart={event => { event.dataTransfer.setData('application/x-jupiter-card', entity.id); event.dataTransfer.effectAllowed = 'move' }}
      href={entityHash(entity.id)}
      className={`jupiter-card entity-card${entity.pinned ? ' pinned' : ''}`}
      data-entity={entity.id}
    >
      <div className="card-top">
        <span className="chip">
          <span aria-hidden="true">{categoryIcon(entity.category)}</span>
          {(entity.category || 'other').replace(/-/g, ' ')}
        </span>
        {entity.pinned && <span className="chip chip-pin">pinned</span>}
      </div>

      <div className="card-project-title">
        {entity.icon && <img className="card-project-icon" src={contentUrl(`/workspace/${entity.folder}/${entity.icon}`)} width="48" height="48" alt="" loading="lazy" decoding="async" />}
        <h3 className="card-title">{entity.title}</h3>
      </div>

      {entity.description && <p className="card-desc">{entity.description}</p>}

      <div className="card-foot">
        <span>
          {steps} step{steps === 1 ? '' : 's'}
        </span>
        <span>·</span>
        <span>{entity.updated ?? entity.created}</span>
        <span className="card-open" aria-hidden="true">
          open →
        </span>
      </div>
    </a>
    <EntityStatusButton entity={entity} />
    </div>
  )
}
