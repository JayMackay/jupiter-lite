import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { chatProjects, createChatProject, pickProjectsFolder, setProjectsFolder } from './client'
import type { ChatProject, ChatProjects } from './types'
import { Icon } from './Icons'
import { isWindows } from './platform'

const sameFolder = (a: string, b: string) => {
  const clean = (value: string) => value.trim().replace(/[\\/]+$/, '').replace(/\//g, isWindows ? '\\' : '/')
  return isWindows ? clean(a).toLowerCase() === clean(b).toLowerCase() : clean(a) === clean(b)
}
const byName = (a: ChatProject, b: ChatProject) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
// Mirrors the service: letters, numbers, spaces, dots and underscores, never a path.
const validName = (value: string) => value.length <= 80 && /^[\p{L}\p{N}._ ]+$/u.test(value) && !/^\.+$/.test(value) && !value.endsWith('.')

// Project folders under the projects folder (<repo>/projects until the user picks
// another). Picking one sets the working folder, which stays editable. Until a folder
// is picked, the first project is used, or the projects folder itself when there are none.
export default function ProjectPicker({ cwd, choose, initial }: { cwd: string; choose: Dispatch<SetStateAction<string>>; initial: string }) {
  const [projects, setProjects] = useState<ChatProject[] | null>(null)
  const [root, setRoot] = useState<{ path: string; custom: boolean } | null>(null)
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const show = (value: ChatProjects) => { setProjects(value.projects); setRoot({ path: value.root, custom: Boolean(value.custom) }) }
  useEffect(() => {
    let alive = true
    chatProjects().then(value => {
      if (!alive) return
      show(value)
      choose(current => sameFolder(current, initial) ? value.projects[0]?.path || value.root : current)
    }).catch(() => { if (alive) setProjects([]) })
    return () => { alive = false }
  }, [choose, initial])
  async function changeRoot(reset = false) {
    setError('')
    try {
      const folder = reset ? null : await pickProjectsFolder()
      if (!reset && !folder) return
      const value = await setProjectsFolder(folder)
      show(value); choose(value.projects[0]?.path || value.root)
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }
  const shown = (projects || []).filter(item => item.name.normalize('NFC').toLowerCase().includes(query.trim().normalize('NFC').toLowerCase()))
  const startCreating = () => { setCreating(true); setDraft(validName(query.trim()) ? query.trim() : ''); setError('') }
  async function create() {
    const name = draft.trim()
    if (!validName(name)) { setError('Use letters, numbers, spaces, dots or underscores for the folder name.'); return }
    setSaving(true); setError('')
    try {
      const project = await createChatProject(name)
      setProjects(current => [...(current || []).filter(item => !sameFolder(item.path, project.path)), project].sort(byName))
      choose(project.path); setCreating(false); setDraft(''); setQuery('')
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setSaving(false) }
  }
  return <div className="desk-field project-field">
    <span className="project-field-heading">Project</span>
    {root && <div className="project-root"><span title={root.path}>{root.path}</span><button type="button" onClick={() => void changeRoot()}>Change folder…</button>{root.custom && <button type="button" onClick={() => void changeRoot(true)}>Use default</button>}</div>}
    <div className="project-search"><Icon name="search" size={14} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Find a project…" aria-label="Find a project" spellCheck={false} /></div>
    <div className="project-list" role="radiogroup" aria-label="Projects">
      {shown.map(item => { const selected = sameFolder(item.path, cwd); return <div key={item.path} className={`project-row ${selected ? 'selected' : ''}`}>
        <button type="button" role="radio" aria-checked={selected} className="project-choice" title={item.path} onClick={() => choose(item.path)}><Icon name="folder" size={16} /><span><strong>{item.name}</strong><small>{item.path}</small></span></button>
      </div> })}
      {!projects && <p className="desk-muted">Loading projects…</p>}
      {projects && !shown.length && <p className="desk-muted">{query ? 'No matching projects.' : 'No project folders yet. Create one below.'}</p>}
    </div>
    {creating
      ? <div className="project-new"><input autoFocus value={draft} maxLength={80} spellCheck={false} placeholder="Project folder name" aria-label="New project folder name" onChange={event => { setDraft(event.target.value); setError('') }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void create() } if (event.key === 'Escape') { event.stopPropagation(); setCreating(false); setError('') } }} /><button type="button" onClick={() => void create()} disabled={saving || !draft.trim()}>{saving ? 'Creating…' : 'Create'}</button><button type="button" onClick={() => { setCreating(false); setError('') }}>Cancel</button></div>
      : <button type="button" className="project-new-button" onClick={startCreating}><Icon name="plus" size={14} />New project folder</button>}
    {error && <p className="desk-error-inline" role="alert">{error}</p>}
  </div>
}
