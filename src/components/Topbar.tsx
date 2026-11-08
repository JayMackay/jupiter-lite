import { useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import type { WorkspaceEntity, WorkspaceStep } from '../types'
import { isDesktop } from '../desktop/client'
import { editWorkspacePage, titleProblem, updateWorkspaceEntity, PAGE_REQUEST_MAX, TITLE_MAX } from '../lib/workspace'
import BrowserSettings from './BrowserSettings'
import { EntityStatusButton } from './EntityControls'

interface TopbarProps {
  entity: WorkspaceEntity | null
  stepIndex: number
  onStep: (id: string, index: number) => void
  onHome: () => void
  reportUrl: string | null
}

const editablePage = (step: WorkspaceStep | undefined) => !!step && !step.viewer && /\.(html?|md|markdown|txt)$/i.test(step.path.split(/[?#]/)[0])

/** The breadcrumb title. Click it to rename the card; Enter or leaving the field saves, Escape cancels. */
function CardTitle({ entity }: { entity: WorkspaceEntity }) {
  const [draft, setDraft] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // Show the saved title until the registry reload catches up.
  const [renamed, setRenamed] = useState<{ from: string; to: string } | null>(null)
  const settled = useRef(false)
  // Once the registry reports any other title, it is the source of truth again.
  if (renamed && entity.title !== renamed.from) setRenamed(null)
  const shown = renamed && entity.title === renamed.from ? renamed.to : entity.title

  if (!isDesktop) return <span className="crumb-current">{entity.title}</span>

  function start() {
    settled.current = false
    setError(''); setDraft(shown)
  }
  function cancel() {
    settled.current = true
    setError(''); setDraft(null)
  }
  async function commit(value: string) {
    if (settled.current || saving) return
    const title = value.trim()
    if (title === shown) { cancel(); return }
    const problem = titleProblem(title)
    if (problem) { setError(problem); return }
    settled.current = true
    setSaving(true); setError('')
    try {
      await updateWorkspaceEntity(entity.id, { title })
      setRenamed({ from: entity.title, to: title })
      setDraft(null)
    } catch (reason) {
      settled.current = false
      setError(reason instanceof Error ? reason.message : 'The title could not be saved. Try again.')
    } finally { setSaving(false) }
  }

  if (draft === null) {
    return (
      <button type="button" className="crumb-current crumb-rename" title="Rename this card" aria-label={`Rename card: ${shown}`} onClick={start}>
        {shown}
      </button>
    )
  }
  return (
    <span className="crumb-title-edit">
      <input
        className="crumb-title-input"
        aria-label="Card title"
        aria-invalid={!!error}
        aria-describedby={error ? 'crumb-title-error' : undefined}
        value={draft}
        maxLength={TITLE_MAX + 50}
        disabled={saving}
        autoFocus
        size={Math.min(Math.max(draft.length + 2, 12), 60)}
        onFocus={event => event.currentTarget.select()}
        onChange={event => { setDraft(event.target.value); if (error) setError('') }}
        onKeyDown={event => {
          event.stopPropagation()
          if (event.key === 'Enter') { event.preventDefault(); void commit(event.currentTarget.value) }
          else if (event.key === 'Escape') { event.preventDefault(); cancel() }
        }}
        onBlur={event => void commit(event.currentTarget.value)}
      />
      {error && <span id="crumb-title-error" className="crumb-title-error" role="alert">{error}</span>}
    </span>
  )
}

/** Asks for a change to the open page, then starts a visible Claude Code chat to make it. */
function EditPageDialog({ entity, step, onClose }: { entity: WorkspaceEntity; step: WorkspaceStep; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [request, setRequest] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useLayoutEffect(() => {
    const element = dialog.current!
    element.showModal()
    return () => element.close()
  }, [])

  async function submit(event: FormEvent) {
    event.preventDefault()
    const wanted = request.trim()
    if (busy) return
    if (!wanted) { setError('Describe what should change.'); return }
    if (wanted.length > PAGE_REQUEST_MAX) { setError(`Keep the request to ${PAGE_REQUEST_MAX.toLocaleString('en-US')} characters or fewer.`); return }
    setBusy(true); setError('')
    try {
      await editWorkspacePage(entity.id, step.path, wanted)
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The chat could not be started. Try again.')
      setBusy(false)
    }
  }

  return createPortal(
    <dialog
      ref={dialog}
      className="entity-menu edit-page-dialog"
      aria-label={`Edit page: ${step.name}`}
      aria-busy={busy}
      onCancel={event => { event.preventDefault(); if (!busy) onClose() }}
      onKeyDown={event => event.stopPropagation()}
    >
      <form onSubmit={event => void submit(event)}>
        <div className="entity-menu-heading">
          <div><span>Edit page</span><h2>{step.name}</h2></div>
          <button type="button" className="entity-menu-close" aria-label="Close edit page" disabled={busy} onClick={onClose}>×</button>
        </div>
        <label className="entity-field">
          What should change?
          <textarea
            aria-label="What should change?"
            value={request}
            rows={5}
            maxLength={PAGE_REQUEST_MAX + 100}
            placeholder="Add a section on voice"
            disabled={busy}
            autoFocus
            onChange={event => { setRequest(event.target.value); if (error) setError('') }}
            onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); event.currentTarget.form?.requestSubmit() } }}
          />
        </label>
        <p className="entity-menu-hint">A Claude Code chat opens and edits this page only, keeping its style. The page reloads here when the chat saves it.</p>
        <div className="entity-form-actions">
          <button type="button" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="submit" className="entity-primary" disabled={busy}>{busy ? 'Starting…' : 'Start chat'}</button>
        </div>
        {error && <p className="entity-menu-error" role="alert">{error}</p>}
      </form>
    </dialog>, document.body,
  )
}

export default function Topbar({ entity, stepIndex, onStep, onHome, reportUrl }: TopbarProps) {
  const [editing, setEditing] = useState<string | null>(null)
  const step = entity?.steps[stepIndex]
  const canEditPage = isDesktop && !!entity && editablePage(step)
  const pageKey = entity && step ? `${entity.id}:${stepIndex}` : null
  return (
    <div className="topbar">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <button className="crumb-link" onClick={onHome}>
          Workspace
        </button>
        {entity && (
          <>
            <span className="crumb-sep">/</span>
            <CardTitle key={entity.id} entity={entity} />
            <EntityStatusButton entity={entity} />
          </>
        )}
        {!isDesktop && <BrowserSettings />}
      </nav>

      {entity && (
        <div className="topbar-right">
          {entity.steps.length > 0 && (
            <div className="step-tabs" role="tablist">
              {entity.steps.map((s, i) => (
                <button
                  key={i}
                  role="tab"
                  aria-selected={i === stepIndex}
                  className={`step-tab${i === stepIndex ? ' active' : ''}`}
                  onClick={() => onStep(entity.id, i)}
                  title={s.name}
                >
                  {s.name}
                </button>
              ))}
            </div>
          )}
          {canEditPage && (
            <button type="button" className="edit-page-button" title="Ask Claude Code to change this page" onClick={() => setEditing(pageKey)}>
              Edit page
            </button>
          )}
          {reportUrl && (
            <a
              className="open-ext"
              href={reportUrl}
              target="_blank"
              rel="noreferrer"
              title="Open report in a new tab"
            >
              ↗
            </a>
          )}
        </div>
      )}
      {canEditPage && entity && step && editing === pageKey && <EditPageDialog entity={entity} step={step} onClose={() => setEditing(null)} />}
    </div>
  )
}
