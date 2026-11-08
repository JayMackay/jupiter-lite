import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import type { WorkspaceEntity } from './types'
import { useWorkspace, archiveCutoff } from './lib/workspace'
import { parseHash, entityHash, resolveStep, type Route } from './lib/route'
import JupiterLogo from './components/JupiterLogo'
import Sidebar from './components/Sidebar'
import Topbar from './components/Topbar'
import HomeGrid from './components/HomeGrid'
import Dashboard from './components/Dashboard'
import EntityControls from './components/EntityControls'
import ReportBoundary from './components/ReportBoundary'
import { contentUrl, isDesktop } from './desktop/client'
import { NAVIGATION_EVENT, navigateSurface, type NavigationTarget } from './lib/navigation'

const Compare3D = lazy(() => import('./components/Compare3D'))
const ReportViewer = lazy(() => import('./components/ReportViewer'))
const EditableCard = lazy(() => import('./components/EditableCard'))

// Freshly-touched work always burns at the top: sort by `updated` (falls back
// to `created`), regardless of status — a report Jupiter just edited must not sink
// under long-lived "active" entities. Status only breaks ties.
const lastTouched = (e: WorkspaceEntity) => e.updated ?? e.created
const statusRank = (e: WorkspaceEntity) => (e.status === 'active' ? 0 : 1)
const byFreshness = (a: WorkspaceEntity, b: WorkspaceEntity) =>
  lastTouched(b).localeCompare(lastTouched(a)) || statusRank(a) - statusRank(b)

export default function App() {
  const { workspace, offline, lastSync, reload } = useWorkspace()
  const [route, setRoute] = useState<Route>(parseHash)
  const [query, setQuery] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('jupiter.sidebarCollapsed') === '1',
  )
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    localStorage.setItem('jupiter.sidebarCollapsed', collapsed ? '1' : '0')
  }, [collapsed])

  const entities = workspace?.entities ?? []
  const entity = entities.find(e => e.id === route.id) ?? null

  const stepIndex = entity
    ? resolveStep(entity.steps.length, route.step, entity.defaultStep)
    : -1
  const step = entity?.steps[stepIndex]
  const reportUrl = entity && step ? contentUrl(`/workspace/${entity.folder}/${step.path}`) : null

  // Hash → state: entity links navigate natively; this also covers back/forward.
  useEffect(() => {
    const onHash = () => { setRoute(parseHash()) }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // "/" focuses search; "[" toggles the sidebar (handy for a clean screen recording).
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement | null
      const typing =
        t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
      if (typing || t?.closest('.jupiter-chats-panel')) return
      if (ev.key === '/') {
        ev.preventDefault()
        searchRef.current?.focus()
      } else if (ev.key === '[') {
        ev.preventDefault()
        setCollapsed(v => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    document.title = entity ? `Jupiter · ${entity.title}` : 'Jupiter'
  }, [entity])

  const goHome = useCallback(() => {
    history.pushState(null, '', window.location.pathname + window.location.search)
    setRoute({ id: null, step: -1 })
  }, [])

  // Selecting Workspace always shows its card list; opening the ribbon hides it.
  useEffect(() => {
    const onWorkspace = () => {
      navigateSurface('workspace'); goHome(); setQuery(''); setCollapsed(false)
    }
    const onNavigate = (event: Event) => {
      const target = (event as CustomEvent<NavigationTarget>).detail
      if (target !== 'workspace') setCollapsed(true)
      if (target === 'capabilities') setQuery('')
    }
    window.addEventListener('jupiter-workspace-home', onWorkspace)
    window.addEventListener(NAVIGATION_EVENT, onNavigate)
    return () => { window.removeEventListener('jupiter-workspace-home', onWorkspace); window.removeEventListener(NAVIGATION_EVENT, onNavigate) }
  }, [goHome])

  const selectStep = useCallback((id: string, index: number) => {
    history.replaceState(null, '', entityHash(id, index))
    setRoute({ id, step: index })
  }, [])

  if (!workspace) {
    return (
      <div className="boot">
        <JupiterLogo size={76} />
      </div>
    )
  }

  const q = query.trim().toLowerCase()
  const searching = q.length > 0
  const cutoff = archiveCutoff()
  // An explicit `archived` status always wins, so a card can be put away by hand
  // while it is still inside the 7-day window. Otherwise it is the date rule,
  // which `pinned` overrides in the other direction.
  const isArchived = (e: WorkspaceEntity) =>
    e.status === 'archived' || (!e.pinned && !e.sample && lastTouched(e) < cutoff)
  const matchesQuery = (e: WorkspaceEntity) =>
    !searching ||
    [e.title, e.description, e.category, e.id].some(s => s && s.toLowerCase().includes(q))

  // Search digs through everything, archive included; otherwise the
  // archive stays hidden behind the toggle.
  const visible = entities.filter(
    e => matchesQuery(e) && (searching || showArchived || !isArchived(e)),
  )
  const archivedCount = entities.filter(isArchived).length

  const pinned = visible.filter(e => e.pinned).sort(byFreshness)
  const rest = visible.filter(e => !e.pinned).sort(byFreshness)
  // Category grouping is for the short working set only. With the archive open or a
  // search running the list is long and the useful order is purely "what did I touch
  // last", so buckets are dropped and everything stays in one date-sorted run.
  const flat = showArchived || searching
  const grouped = new Map<string, WorkspaceEntity[]>()
  for (const e of rest) {
    const cat = flat ? 'by date' : e.category || 'other'
    if (!grouped.has(cat)) grouped.set(cat, [])
    grouped.get(cat)!.push(e)
  }

  return (
    <EntityControls entities={entities} onChanged={reload}>
    <div className={`app-layout${collapsed ? ' sidebar-collapsed' : ''}`} data-entity={route.id}>
      <Sidebar
        collapsed={collapsed}
        pinned={pinned}
        grouped={grouped}
        activeId={route.id}
        query={query}
        onQuery={setQuery}
        searchRef={searchRef}
        archivedCount={archivedCount}
        showArchived={showArchived}
        onToggleArchived={() => setShowArchived(v => !v)}
        total={entities.length}
        offline={offline}
        lastSync={lastSync}
        onCollapse={() => setCollapsed(true)}
      />

      {/* The desktop rail's Workspace button replaces the floating logo. */}
      {!isDesktop && (
        <button
          className="sidebar-reopen"
          onClick={() => setCollapsed(false)}
          title="Show menu ( [ )"
          aria-label="Show menu"
        >
          <JupiterLogo size={38}  />
        </button>
      )}

      {/* On the desktop home the dashboard runs to the top; an open card keeps its bar. */}
      <main className={`main${entity ? ' is-card' : ' is-home'}`}>
        {(!isDesktop || entity) && <Topbar
          entity={entity}
          stepIndex={stepIndex}
          onStep={selectStep}
          onHome={goHome}
          // A compare3d step's "report" is a JSON manifest — opening it raw in a
          // tab helps nobody, so the external link is hidden for those.
          reportUrl={step?.viewer === 'compare3d' || step?.viewer === 'card' ? null : reportUrl}
        />}

        <div className="content">
          <ReportBoundary key={reportUrl || 'home'} onHome={goHome}>
          {entity && reportUrl && step?.viewer === 'card' ? (
            <Suspense fallback={<div className="report-loading">Opening card…</div>}><EditableCard key={`${entity.id}:${stepIndex}`} url={reportUrl} entityId={entity.id} step={stepIndex} /></Suspense>
          ) : entity && reportUrl && step?.viewer === 'compare3d' ? (
            <Suspense fallback={<div className="boot"><JupiterLogo size={56} animated={false} /></div>}><Compare3D
              key={reportUrl}
              manifestUrl={reportUrl}
              baseUrl={reportUrl.slice(0, reportUrl.lastIndexOf('/'))}
            /></Suspense>
          ) : entity && reportUrl ? (
            <Suspense fallback={<div className="boot"><JupiterLogo size={56} animated={false} /></div>}><ReportViewer key={reportUrl} url={reportUrl} title={step?.name ?? entity.title} relativePath={`workspace/${entity.folder}/${step?.path}`} /></Suspense>
          ) : searching ? (
            <HomeGrid
              entities={entities}
              pinned={pinned}
              grouped={grouped}
              offline={offline}
              searching={searching}
              query={query}
            />
          ) : (
            <Dashboard
              entities={entities}
              offline={offline}
              cards={<HomeGrid entities={entities} pinned={pinned} grouped={grouped} offline={offline} searching={false} query="" />}
            />
          )}
          </ReportBoundary>
        </div>
      </main>
    </div>
    </EntityControls>
  )
}
