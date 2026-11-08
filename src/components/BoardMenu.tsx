import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import '../styles/work-board.css'

export type BoardMenuRow = { slug: string; title: string; count: number }

const ICONS: Record<string, ReactNode> = {
  plus: <path d="M12 5v14M5 12h14" />,
  chevron: <path d="M9 6l6 6-6 6" />,
  trash: <><path d="M4 7h16M10 11v6M14 11v6" /><path d="M6 7l1 13h10l1-13M9 7V4h6v3" /></>,
  save: <><path d="M5 4h11l3 3v13H5z" /><path d="M8.5 4v5h6V4M8.5 20v-6h7v6" /></>,
  discard: <><path d="M8 5L4 9l4 4" /><path d="M4 9h10.5a5 5 0 0 1 0 10H9" /></>,
}
const Icon = ({ name }: { name: keyof typeof ICONS }) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONS[name]}</svg>
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

interface BoardMenuProps {
  rows: BoardMenuRow[]
  /** The open board's slug, highlighted in the list. */
  current: string | null
  /** The button label: the open board's title. */
  title: string | null
  empty?: string
  newLabel?: string
  onPick: (slug: string) => void
  onNew: () => void
  /** Saves now; the menu shows Saving, then Saved for a moment. Hidden when not given. */
  onSave?: () => Promise<unknown> | void
  /** True when there is something to save or discard. */
  unsaved?: boolean
  /** Drops unsaved changes, after a confirming second click. Hidden when not given. */
  onDiscard?: () => void
  /** Deletes the open board, after a confirming second click. Hidden when not given. */
  onDelete?: () => void
}

// The board picker shared by To do and Brainstorm: a button with the board title that opens a menu
// of boards (the current one highlighted, with its item count), New, Save, Discard and Delete this
// board. Discard and Delete arm on the first click and act on the second. Escape, Tab or a click
// outside closes it.
export default function BoardMenu({ rows, current, title, empty = 'No boards', newLabel = 'New board', onPick, onNew, onSave, unsaved = false, onDiscard, onDelete }: BoardMenuProps) {
  const [open, setOpen] = useState(false)
  const [armed, setArmed] = useState<'delete' | 'discard' | null>(null)
  const [saving, setSaving] = useState<'' | 'saving' | 'saved'>('')
  const wrap = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const savedTimer = useRef<number | undefined>(undefined)
  const close = useCallback((refocus: boolean) => {
    setOpen(false); setArmed(null); setSaving(current => current === 'saved' ? '' : current)
    if (refocus) button.current?.focus()
  }, [])
  useEffect(() => {
    if (!open) return
    const onDown = (event: PointerEvent) => { if (!wrap.current?.contains(event.target as Node)) close(false) }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [open, close])
  useEffect(() => () => window.clearTimeout(savedTimer.current), [])
  // Opening moves focus to the current board (or the first entry).
  useEffect(() => {
    if (!open) return
    const element = menu.current
    ;(element?.querySelector<HTMLElement>('[aria-current="true"]') ?? element?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)'))?.focus()
  }, [open])
  const save = () => {
    if (!onSave || saving === 'saving') return
    window.clearTimeout(savedTimer.current)
    // Save disables itself, which would drop focus out of the menu (and Escape would then close the
    // whole window), so the menu keeps it.
    menu.current?.focus()
    setSaving('saving')
    Promise.resolve(onSave()).then(() => {
      setSaving('saved')
      savedTimer.current = window.setTimeout(() => setSaving(''), 1600)
    }, () => setSaving(''))
  }
  const onKey = (event: ReactKeyboardEvent) => {
    // Escape inside the menu closes the menu only, not the dashboard window around the board.
    if (event.key === 'Escape') event.nativeEvent.stopPropagation()
    if (event.key === 'Escape' && open) { event.preventDefault(); close(true); return }
    if (!open) { if (event.key === 'ArrowDown' && event.target === button.current) { event.preventDefault(); setOpen(true) } return }
    if (event.key === 'Tab') { close(false); return }
    const entries = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [])]
    const at = entries.indexOf(document.activeElement as HTMLElement)
    const target = event.key === 'ArrowDown' ? (at + 1) % entries.length : event.key === 'ArrowUp' ? (at - 1 + entries.length) % entries.length : event.key === 'Home' ? 0 : event.key === 'End' ? entries.length - 1 : -1
    if (target >= 0 && entries.length) { event.preventDefault(); entries[target].focus() }
  }
  return (
    <div className="jh-wb jh-wb-picker" ref={wrap} onKeyDown={onKey}>
      <button ref={button} type="button" className="jh-wb-picker-button" aria-haspopup="menu" aria-expanded={open} aria-label="Switch board" title="Switch board"
        onClick={() => { if (open) close(false); else setOpen(true) }}>
        <span>{title ?? (rows.length ? 'Pick a board' : empty)}</span><Icon name="chevron" />
      </button>
      {open && (
        <div ref={menu} className="jh-wb-menu" role="menu" aria-label="Boards" tabIndex={-1}>
          {rows.map(row => (
            <button key={row.slug} type="button" role="menuitem" aria-current={row.slug === current} onClick={() => { close(false); if (row.slug !== current) onPick(row.slug) }}>
              <span className="jh-wb-menu-name">{row.title}</span><small>{plural(row.count, 'item')}</small>
            </button>
          ))}
          {rows.length > 0 && <i className="jh-wb-menu-sep" aria-hidden="true" />}
          <button type="button" role="menuitem" className="jh-wb-menu-new" onClick={() => { close(false); onNew() }}><Icon name="plus" />{newLabel}</button>
          {onSave && <button type="button" role="menuitem" className={`jh-wb-menu-save${saving === 'saved' ? ' is-saved' : ''}`} disabled={!unsaved || saving !== ''} onClick={save}>
            <Icon name="save" />{saving === 'saving' ? 'Saving' : saving === 'saved' ? 'Saved' : 'Save'}
          </button>}
          {onDiscard && <button type="button" role="menuitem" className={`jh-wb-menu-discard${armed === 'discard' ? ' is-armed' : ''}`} disabled={!unsaved}
            onClick={() => { if (armed !== 'discard') { setArmed('discard'); return } close(true); onDiscard() }}>
            <Icon name="discard" /><span className="jh-wb-menu-name">{armed === 'discard' ? 'Confirm: discard changes' : 'Discard'}</span>
          </button>}
          {onDelete && <button type="button" role="menuitem" className={`jh-wb-menu-delete${armed === 'delete' ? ' is-armed' : ''}`} onClick={() => { if (armed !== 'delete') { setArmed('delete'); return } close(false); onDelete() }}>
            <Icon name="trash" /><span className="jh-wb-menu-name">{armed === 'delete' ? `Confirm: delete ${title ?? 'this board'}` : 'Delete this board'}</span>
          </button>}
        </div>
      )}
    </div>
  )
}
