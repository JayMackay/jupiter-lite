import type { RefObject } from 'react'
import type { WorkspaceEntity } from '../types'
import { entityHash } from '../lib/route'
import { categoryIcon } from '../lib/categories'
import { contentUrl } from '../desktop/client'
import JupiterLogo from './JupiterLogo'
import JupiterText from './JupiterText'
import { EntityStatusButton } from './EntityControls'

interface SidebarProps {
  collapsed?: boolean
  pinned: WorkspaceEntity[]
  grouped: Map<string, WorkspaceEntity[]>
  activeId: string | null
  query: string
  onQuery: (q: string) => void
  searchRef: RefObject<HTMLInputElement | null>
  archivedCount: number
  showArchived: boolean
  onToggleArchived: () => void
  total: number
  offline: boolean
  lastSync: Date | null
  onCollapse: () => void
}

function Item({ entity, active }: { entity: WorkspaceEntity; active: boolean }) {
  return (
    <div className="sidebar-item-row" data-card={entity.id}>
    <a
      href={entityHash(entity.id)}
      className={`sidebar-item${active ? ' active' : ''}${entity.pinned ? ' pinned' : ''}`}
      aria-current={active ? 'page' : undefined}
    >
      <span className="item-icon" aria-hidden="true">
        {entity.icon ? <img src={contentUrl(`/workspace/${entity.folder}/${entity.icon}`)} width="24" height="24" alt="" decoding="async" /> : categoryIcon(entity.category)}
      </span>
      <span className="item-text">{entity.title}</span>
    </a>
    <EntityStatusButton entity={entity} />
    </div>
  )
}

export default function Sidebar({
  collapsed = false,
  pinned,
  grouped,
  activeId,
  query,
  onQuery,
  searchRef,
  archivedCount,
  showArchived,
  onToggleArchived,
  total,
  offline,
  lastSync,
  onCollapse,
}: SidebarProps) {
  const empty = pinned.length === 0 && grouped.size === 0

  return (
    <aside className="sidebar" inert={collapsed} aria-hidden={collapsed}>
      <div className="sidebar-brand">
        <JupiterLogo size={54}  />
        <div className="brand-text">
          <JupiterText height={26}  />
          <span className="brand-sub">workspace</span>
        </div>
        <button
          className="sidebar-collapse"
          onClick={onCollapse}
          title="Hide menu ( [ )"
          aria-label="Hide menu"
        >
          ‹
        </button>
      </div>

      <div className="sidebar-search">
        <span className="search-icon" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <circle cx="7" cy="7" r="4.6" />
            <path d="M10.5 10.5 14 14" />
          </svg>
        </span>
        <input
          ref={searchRef}
          value={query}
          onChange={ev => onQuery(ev.target.value)}
          onKeyDown={ev => {
            if (ev.key === 'Escape') {
              onQuery('')
              ev.currentTarget.blur()
            }
          }}
          aria-label="Search entities"
        />
        {query && (
          <button className="search-clear" onClick={() => onQuery('')} aria-label="Clear search">
            ×
          </button>
        )}
      </div>

      <nav className="sidebar-list">
        {pinned.length > 0 && (
          <div>
            <div className="sidebar-section">
              <span className="sidebar-label">{'\u{1F4CC}'} pinned</span>
            </div>
            {pinned.map(e => (
              <Item key={e.id} entity={e} active={e.id === activeId} />
            ))}
          </div>
        )}

        {[...grouped.entries()].map(([cat, list]) => (
          <div key={cat}>
            <div className="sidebar-section">
              <span className="sidebar-label">{cat.replace(/-/g, ' ')}</span>
            </div>
            {list.map(e => (
              <Item key={e.id} entity={e} active={e.id === activeId} />
            ))}
          </div>
        ))}

        {empty && <div className="sidebar-empty">Nothing matches.</div>}

        {archivedCount > 0 && !query && (
          <button className="sidebar-archive-toggle" onClick={onToggleArchived}>
            {showArchived
              ? `▼ Hide archive (${archivedCount})`
              : `▶ Show archive (${archivedCount})`}
          </button>
        )}
      </nav>

      <footer className="sidebar-foot">
        <span className={`sync-dot${offline ? ' offline' : ''}`} />
        <span>
          {total} entities ·{' '}
          {offline
            ? 'offline'
            : lastSync
              ? `synced ${lastSync.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
              : 'syncing…'}
        </span>
      </footer>
    </aside>
  )
}
