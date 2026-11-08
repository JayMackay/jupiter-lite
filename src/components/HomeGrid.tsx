import { useEffect, useState, type DragEvent } from 'react'
import { updateWorkspaceEntity } from '../lib/workspace'
import { isDesktop, reportError } from '../desktop/client'
import type { WorkspaceEntity } from '../types'
import { categoryIcon } from '../lib/categories'
import JupiterCard from './JupiterCard'
import JupiterLogo from './JupiterLogo'

interface HomeGridProps {
  entities: WorkspaceEntity[]
  pinned: WorkspaceEntity[]
  grouped: Map<string, WorkspaceEntity[]>
  offline: boolean
  searching: boolean
  query: string
}

function greeting(): string {
  const h = new Date().getHours()
  if (h < 5) return 'Burning the midnight oil, boss?'
  if (h < 12) return 'Good morning.'
  if (h < 18) return 'Good afternoon.'
  return 'Good evening.'
}

export default function HomeGrid({
  entities,
  pinned,
  grouped,
  offline,
  searching,
  query,
}: HomeGridProps) {
  const [dragOver, setDragOver] = useState<string | null>(null)
  useEffect(() => {
    const end = () => setDragOver(null)
    const drag = (event: Event) => {
      const { id, x, y } = (event as CustomEvent<{ id: string; x: number; y: number }>).detail
      const section = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-card-section]')?.dataset.cardSection
      const category = section && section !== 'by date' ? section : null
      setDragOver(category)
      if (event.type === 'jupiter-card-drop') {
        end()
        if (category && entities.some(entity => entity.id === id)) void updateWorkspaceEntity(id, category === 'pinned' ? { pinned: true } : { category, pinned: false }).catch(reportError)
      }
    }
    window.addEventListener('jupiter-card-drag', drag); window.addEventListener('jupiter-card-drop', drag); window.addEventListener('jupiter-card-drag-end', end)
    return () => { window.removeEventListener('jupiter-card-drag', drag); window.removeEventListener('jupiter-card-drop', drag); window.removeEventListener('jupiter-card-drag-end', end) }
  }, [entities])
  const dropProps = (category: string) => ({
    onDragOver: (event: DragEvent) => { if (!isDesktop || category === 'by date' || !event.dataTransfer.types.includes('application/x-jupiter-card')) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDragOver(category) },
    onDragLeave: (event: DragEvent) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragOver(null) },
    onDrop: async (event: DragEvent) => {
      event.preventDefault(); setDragOver(null)
      const id = event.dataTransfer.getData('application/x-jupiter-card')
      if (!isDesktop || category === 'by date' || !entities.some(entity => entity.id === id)) return
      try { await updateWorkspaceEntity(id, category === 'pinned' ? { pinned: true } : { category, pinned: false }); window.dispatchEvent(new Event('jupiter-workspace-changed')) } catch (error) { reportError(error) }
    },
  })
  const sections = new Map(grouped)
  if (!searching && !sections.has('by date')) for (const category of ['research', 'dev', 'image-gen', ...entities.map(entity => entity.category || 'other')]) if (!sections.has(category)) sections.set(category, [])
  const activeCount = entities.filter(e => e.status === 'active').length
  const categoryCount = new Set(entities.map(e => e.category || 'other')).size
  const shown = pinned.length + [...grouped.values()].reduce((n, list) => n + list.length, 0)

  return (
    <div className="home">
      <header className="home-hero">
        <JupiterLogo size={84} />
        <div>
          <h1 className="home-title">{greeting()}</h1>
          <p className="home-sub">
            <b>{activeCount}</b> active · <b>{entities.length}</b> entities ·{' '}
            <b>{categoryCount}</b> categories
            {offline && <span className="home-offline"> · workspace.json unreachable</span>}
          </p>
        </div>
      </header>

      {searching && (
        <p className="home-filter">
          {shown === 0 ? 'No matches for' : `${shown} match${shown === 1 ? '' : 'es'} for`}{' '}
          “{query.trim()}” — archive included
        </p>
      )}

      {(!searching || pinned.length > 0) && (
        <section className={`home-section${dragOver === 'pinned' ? ' card-drop-active' : ''}`} data-card-section="pinned" {...dropProps('pinned')}>
          <div className="section-head">
            <span className="section-title">{'\u{1F4CC}'} pinned</span>
          </div>
          <div className="card-grid">
            {pinned.map(e => (
              <JupiterCard key={e.id} entity={e} />
            ))}
          </div>
        </section>
      )}

      {[...sections.entries()].map(([cat, list]) => (
        <section key={cat} className={`home-section${dragOver === cat ? ' card-drop-active' : ''}`} data-card-section={cat} {...dropProps(cat)}>
          <div className="section-head">
            <span className="section-title">
              {categoryIcon(cat)} {cat.replace(/-/g, ' ')}
            </span>
          </div>
          <div className="card-grid">
            {list.map(e => (
              <JupiterCard key={e.id} entity={e} />
            ))}
          </div>
        </section>
      ))}

      {shown === 0 && !searching && (
        <div className="home-empty">
          {offline
            ? 'Could not load workspace.json. Is the public/workspace link in place? Run npm run dev again.'
            : 'Nothing here yet. New work will appear as cards.'}
        </div>
      )}
    </div>
  )
}
