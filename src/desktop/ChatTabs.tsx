import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { AgentInfo, ChatSession } from './types'
import { api, reportError } from './client'
import { chatActivityLabel } from './chatActivity'
import { Icon } from './Icons'
import SessionLogo from './SessionLogo'
import { chatBuckets, fitButtons, tabColors, type ChatBucket } from './chatOrder'

/** A drag carries one chat, or a whole group when it starts on the group's button. */
type Drag = { id: string; group?: string; pinned: boolean; startX: number; startY: number; moving: boolean }
type Drop = { id: string; position: 'before' | 'after' } | { group: string } | { beside: string; pinned: boolean; targetId: string; position: 'before' | 'after' }
type Menu = { kind: 'tab'; item: ChatSession; x: number; y: number } | { kind: 'group'; key: string; x: number; y: number }
/** The one open picker: a group's chats, or the groups that did not fit in the row. */
type Picker = { kind: 'group'; key: string } | { kind: 'more' }
type Place = { left: number; top: number; width: number; maxHeight: number }

const GAP = 4
const moreKey = 'more'

function Swatches({ label, value, onChange }: { label: string; value: string | null; onChange: (value: string | null) => void }) {
  return <div className="swatches" role="group" aria-label={label}>
    <button type="button" className={`tab-color-swatch no-color ${!value ? 'selected' : ''}`} aria-label={`No ${label.toLowerCase()}`} aria-pressed={!value} title={label === 'Group color' ? 'Automatic' : 'No color'} onClick={() => onChange(null)} />
    {tabColors.map(color => <button key={color.value} type="button" className={`tab-color-swatch ${value === color.value ? 'selected' : ''}`} style={{ '--swatch': color.value } as React.CSSProperties} aria-label={`${color.name} ${label.toLowerCase()}`} aria-pressed={value === color.value} title={color.name} onClick={() => onChange(color.value)} />)}
  </div>
}

const Chevron = ({ open }: { open: boolean }) => <svg className={`chip-chevron ${open ? 'open' : ''}`} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
const Dots = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.9" /><circle cx="12" cy="12" r="1.9" /><circle cx="19" cy="12" r="1.9" /></svg>
const Check = () => <svg className="picker-check" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7" /></svg>

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`
/** Counts and activity of a group in words, so the button never relies on colour alone. */
const summary = (bucket: ChatBucket) => [`${plural(bucket.items.length, 'open chat')}`, bucket.working ? `${bucket.working} working` : '', bucket.unread ? `${bucket.unread} unread` : ''].filter(Boolean).join(' · ')
const bucketLabel = (bucket: ChatBucket) => bucket.name ?? 'Ungrouped'

/** A short state for a chat row; a ready chat says nothing. */
function stateText(item: ChatSession) {
  const working = item.status === 'running' && item.activity === 'working'
  if (working && item.unread) return 'Working · unread'
  if (working) return 'Working'
  if (item.unread) return 'Unread'
  if (item.status !== 'running') return item.status === 'starting' ? 'Starting' : 'Stopped'
  return item.activity === 'waiting' ? 'Needs attention' : ''
}

/** What the group button and its width probe both show. */
function Face({ name, count, working, unread, open }: { name: string; count: number; working: number; unread: number; open: boolean }) {
  return <>
    <span className="chip-name">{name}</span><small>{count}</small>
    {working > 0 && <i className="chip-working" aria-hidden="true" />}{unread > 0 && <i className="chip-unread" aria-hidden="true" />}
    <Chevron open={open} />
  </>
}

const sameList = (a: number[], b: number[]) => a.length === b.length && a.every((value, index) => value === b[index])
const samePicker = (a: Picker | null, b: Picker) => !!a && a.kind === b.kind && (a.kind === 'more' || a.key === (b as { key: string }).key)
const findTrigger = (container: HTMLElement | null, value: Picker | null) => value ? [...(container?.querySelectorAll<HTMLElement>('[data-picker-trigger]') ?? [])].find(element => element.dataset.pickerTrigger === (value.kind === 'more' ? moreKey : value.key)) : undefined

export default function ChatTabs({ items, selectedId, agents, groups, groupColors, historyCounts, choose, close, setGroupColor }: {
  items: ChatSession[]; selectedId?: string; agents: AgentInfo[]; groups: string[]; groupColors: Record<string, string>; historyCounts: Record<string, number>
  choose: (id: string) => void; close: (id: string) => void; setGroupColor: (name: string, value: string | null) => void
}) {
  const root = useRef<HTMLDivElement>(null)
  const bar = useRef<HTMLDivElement>(null)
  const probe = useRef<HTMLDivElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const menuBox = useRef<HTMLDivElement>(null)
  const invoker = useRef<HTMLElement | null>(null)
  const focusBack = useRef<string | null>(null)
  const gesture = useRef<Drag | null>(null)
  const drop = useRef<Drop | null>(null)
  const suppressClick = useRef(false)
  const pickerId = useId()
  /** Which group buttons stay in the row, and whether the overflow button has room for its full label. */
  const [fit, setFit] = useState<{ shown: number[]; full: boolean } | null>(null)
  const [picker, setPicker] = useState<Picker | null>(null)
  const [place, setPlace] = useState<Place | null>(null)
  const [dragging, setDragging] = useState<{ id: string; group?: string; pinned: boolean; x: number; y: number } | null>(null)
  const [target, setTarget] = useState<Drop | null>(null)
  const [menu, setMenu] = useState<Menu | null>(null)
  const [draft, setDraft] = useState('')
  const [rename, setRename] = useState<string | null>(null)
  const [confirm, setConfirm] = useState(false)
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)
  const [width, setWidth] = useState(0)
  const cancelEdit = useRef(false)

  const buckets = chatBuckets(items, groupColors)
  const signature = buckets.map(bucket => `${bucket.key}|${bucket.items.length}|${bucket.working}|${bucket.unread}`).join(',')
  const active = buckets.findIndex(bucket => bucket.items.some(item => item.id === selectedId))
  const shown = fit ? fit.shown.filter(index => index < buckets.length) : buckets.map((_, index) => index)
  const moreName = fit?.full ? 'More groups' : 'More'
  const hidden = buckets.filter((_, index) => !shown.includes(index))
  // A picker or menu whose group has gone, or that no longer overflows, closes instead of pointing at nothing.
  const pickerBuckets = picker ? picker.kind === 'more' ? hidden : buckets.filter(bucket => bucket.key === picker.key) : []
  if (picker && !pickerBuckets.length) setPicker(null)
  const menuBucket = menu?.kind === 'group' ? buckets.find(bucket => bucket.key === menu.key) : undefined
  if (menu?.kind === 'group' && !menuBucket) setMenu(null)

  function saveName() {
    if (!editing) return
    const item = items.find(entry => entry.id === editing.id), name = editing.name.trim()
    setEditing(null)
    if (item && name && name !== item.name) api(`/sessions/${item.id}`, { name }, 'PATCH').catch(reportError)
  }
  const clear = () => { gesture.current = null; drop.current = null; setDragging(null); setTarget(null) }
  const triggers = () => [...(bar.current?.querySelectorAll<HTMLElement>('[data-picker-trigger]') ?? [])]
  const focusRow = (id: string) => requestAnimationFrame(() => [...(popup.current?.querySelectorAll<HTMLElement>('[data-chat-tab]') ?? [])].find(row => row.dataset.chatTab === id)?.querySelector<HTMLElement>('.chat-picker-item')?.focus())

  // Which group buttons fit is measured from a hidden copy of every button, so the row never wraps or jumps.
  useLayoutEffect(() => {
    const room = bar.current?.clientWidth ?? 0, copies = probe.current
    if (!copies || !room) return
    const widths = [...copies.querySelectorAll<HTMLElement>('[data-probe="group"]')].map(element => Math.ceil(element.getBoundingClientRect().width))
    const probed = (name: string) => Math.ceil(copies.querySelector<HTMLElement>(`[data-probe="${name}"]`)?.getBoundingClientRect().width ?? 0)
    const shown = fitButtons(widths, room, probed('more'), GAP, active)
    // The overflow button says More groups when there is room for it, and More when the row is tight.
    const full = shown.length < widths.length && room - shown.reduce((sum, index) => sum + widths[index] + GAP, 0) >= probed('more-full')
    setFit(current => current && current.full === full && sameList(current.shown, shown) ? current : { shown, full })
  }, [active, signature, width])
  useEffect(() => {
    const element = bar.current
    if (!element) return
    const observer = new ResizeObserver(entries => setWidth(entries[0].contentRect.width))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  // After a pick, focus returns to the group of the chat that is now open, unless the terminal has taken it.
  useEffect(() => {
    if (picker || focusBack.current === null || selectedId !== focusBack.current) return
    focusBack.current = null
    if (!document.activeElement || document.activeElement === document.body) bar.current?.querySelector<HTMLElement>('[data-picker-trigger][aria-current="true"]')?.focus()
  }, [picker, selectedId])
  // Opening a picker moves focus to the open chat, or the first one, so the arrow keys work at once.
  useEffect(() => {
    if (!picker) return
    const list = popup.current
    ;(list?.querySelector<HTMLElement>('.chat-picker-item[aria-current="true"]') ?? list?.querySelector<HTMLElement>('.chat-picker-item'))?.focus()
  }, [picker])
  const menuOpen = menu !== null
  useEffect(() => { if (menuOpen) menuBox.current?.querySelector<HTMLElement>('button, input')?.focus() }, [menuOpen])

  const clearRef = useRef(clear)
  const latest = useRef({ picker, menu })
  useEffect(() => { clearRef.current = clear; latest.current = { picker, menu } })
  // Escape cancels a drag first, then the menu, then the picker, and each hands focus back to what opened it.
  // The listener is added once and reads the latest state: another Escape handler can re-render this component
  // mid dispatch, and a listener that re-subscribes on every render would be skipped for that key press.
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      const { picker, menu } = latest.current
      if (gesture.current) { clearRef.current(); return }
      if (menu) { setMenu(null); if (invoker.current?.isConnected) invoker.current.focus(); return }
      if (picker) { const trigger = findTrigger(bar.current, picker); setPicker(null); trigger?.focus() }
    }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [])
  useEffect(() => {
    if (!menu) return
    const dismiss = (event: Event) => { if (event.type === 'resize' || !(event.target as HTMLElement | null)?.closest?.('.tab-menu')) setMenu(null) }
    window.addEventListener('pointerdown', dismiss)
    window.addEventListener('resize', dismiss)
    return () => { window.removeEventListener('pointerdown', dismiss); window.removeEventListener('resize', dismiss) }
  }, [menu])
  // Outside clicks, focus moving elsewhere and a resize dismiss the picker; the other group buttons and the menu count as inside.
  useEffect(() => {
    if (!picker) return
    const inside = (node: EventTarget | null) => !!(node as HTMLElement | null)?.closest?.('.chat-picker, .tab-menu, [data-picker-trigger]')
    const trigger = findTrigger(bar.current, picker)
    const outside = (event: PointerEvent) => {
      if (inside(event.target)) return
      setPicker(null)
      window.setTimeout(() => { if (!document.activeElement || document.activeElement === document.body) trigger?.focus() }, 0)
    }
    const away = (event: FocusEvent) => { if (!inside(event.target)) setPicker(null) }
    const resize = () => setPicker(null)
    window.addEventListener('pointerdown', outside)
    document.addEventListener('focusin', away)
    window.addEventListener('resize', resize)
    return () => { window.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', away); window.removeEventListener('resize', resize) }
  }, [picker])

  function placeBelow(trigger: HTMLElement): Place {
    const bounds = (root.current?.closest('.chats-surface') ?? document.documentElement).getBoundingClientRect(), rect = trigger.getBoundingClientRect()
    const width = Math.min(340, Math.max(220, bounds.width - 16)), top = rect.bottom + 4
    return { left: Math.max(bounds.left + 8, Math.min(rect.left, bounds.right - width - 8)), top, width, maxHeight: Math.max(140, window.innerHeight - top - 12) }
  }
  function toggle(next: Picker, trigger: HTMLElement) {
    focusBack.current = null
    if (samePicker(picker, next)) { setPicker(null); return }
    setMenu(null); setEditing(null); setPlace(placeBelow(trigger)); setPicker(next)
  }
  function triggerKeys(event: React.KeyboardEvent<HTMLElement>, next: Picker) {
    if (event.key === 'ArrowDown') { event.preventDefault(); if (samePicker(picker, next)) popup.current?.querySelector<HTMLElement>('.chat-picker-item')?.focus(); else toggle(next, event.currentTarget) }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const list = triggers(), index = list.indexOf(event.currentTarget)
      const other = list[index + (event.key === 'ArrowRight' ? 1 : -1)]
      if (other) { event.preventDefault(); other.focus() }
    }
  }
  function pick(id: string) {
    focusBack.current = id
    setPicker(null)
    choose(id)
  }
  /** Arrow keys walk the chats of an open picker; left and right walk the buttons of one row. */
  function pickerKeys(event: React.KeyboardEvent<HTMLElement>) {
    const element = event.target as HTMLElement, row = element.closest<HTMLElement>('.chat-picker-row')
    if (!row || (element.tagName === 'INPUT')) return
    const rows = [...(popup.current?.querySelectorAll<HTMLElement>('.chat-picker-row') ?? [])], index = rows.indexOf(row)
    const kind = ['.chat-picker-item', '.chat-picker-more', '.chat-picker-close'].find(selector => element.matches(selector))
    const go = (node?: HTMLElement | null) => { if (node) { event.preventDefault(); node.focus() } }
    const controls = [...row.querySelectorAll<HTMLElement>('button')], at = controls.indexOf(element)
    if (event.key === 'ArrowDown' && kind) go(rows[(index + 1) % rows.length].querySelector<HTMLElement>(kind))
    else if (event.key === 'ArrowUp' && kind) go(rows[(index - 1 + rows.length) % rows.length].querySelector<HTMLElement>(kind))
    else if (event.key === 'Home' && kind) go(rows[0].querySelector<HTMLElement>(kind))
    else if (event.key === 'End' && kind) go(rows[rows.length - 1].querySelector<HTMLElement>(kind))
    else if (event.key === 'ArrowRight') go(controls[at + 1])
    else if (event.key === 'ArrowLeft') go(controls[at - 1])
  }
  function menuKeys(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const controls = [...(menuBox.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input') ?? [])], index = controls.indexOf(event.target as HTMLElement)
    if (index < 0) return
    event.preventDefault()
    controls[(index + (event.key === 'ArrowDown' ? 1 : -1) + controls.length) % controls.length].focus()
  }

  const openMenu = (event: React.MouseEvent, value: Menu) => { event.preventDefault(); event.stopPropagation(); const element = event.currentTarget as HTMLElement; invoker.current = element.matches('button') ? element : element.querySelector('button'); setDraft(''); setRename(null); setConfirm(false); setMenu(value) }
  const menuFrom = (event: React.MouseEvent<HTMLElement>, make: (x: number, y: number) => Menu) => { const rect = event.currentTarget.getBoundingClientRect(); invoker.current = event.currentTarget; setDraft(''); setRename(null); setConfirm(false); setMenu(make(rect.left, rect.bottom + 2)) }
  const patch = (id: string, data: object) => { setMenu(null); api(`/sessions/${id}`, data, 'PATCH').catch(reportError); if (invoker.current?.isConnected) invoker.current.focus() }
  const ungroup = (bucket: ChatBucket) => { setMenu(null); Promise.all(bucket.items.map(item => api(`/sessions/${item.id}`, { group: null }, 'PATCH'))).catch(reportError) }
  const renameGroup = (from: string, to: string) => { setMenu(null); setRename(null); if (to !== from) api('/groups/rename', { from, to }).catch(reportError) }
  const deleteGroup = (name: string) => { setMenu(null); setConfirm(false); api('/groups/delete', { name }).catch(reportError) }
  /** Closing a chat from a picker keeps focus in the list, on the neighbouring chat. */
  function closeChat(item: ChatSession) {
    const bucket = buckets.find(entry => entry.items.some(other => other.id === item.id)), index = bucket?.items.findIndex(other => other.id === item.id) ?? -1
    const next = bucket?.items[index + 1] ?? bucket?.items[index - 1]
    setMenu(null); close(item.id)
    if (next && picker) focusRow(next.id)
    else requestAnimationFrame(() => triggers()[0]?.focus())
  }
  const neighbor = (item: ChatSession, step: -1 | 1) => {
    const bucket = buckets.find(entry => entry.items.some(other => other.id === item.id)), other = bucket?.items[(bucket.items.findIndex(entry => entry.id === item.id)) + step]
    return other && other.pinned === item.pinned ? other : undefined
  }
  const moveChat = (item: ChatSession, step: -1 | 1) => { const other = neighbor(item, step); setMenu(null); if (invoker.current?.isConnected) invoker.current.focus(); if (other) api(`/sessions/${item.id}/reorder`, { targetId: other.id, position: step < 0 ? 'before' : 'after' }).catch(reportError) }
  const groupNeighbor = (bucket: ChatBucket, step: -1 | 1) => {
    const named = buckets.filter(entry => entry.name), other = named[named.findIndex(entry => entry.key === bucket.key) + step]
    return other && other.items[0].pinned === bucket.items[0].pinned ? other : undefined
  }
  const moveGroup = (bucket: ChatBucket, step: -1 | 1) => { const other = groupNeighbor(bucket, step); setMenu(null); if (other) api('/groups/move', { group: bucket.name, pinned: bucket.items[0].pinned, targetId: other.items[0].id, position: step < 0 ? 'before' : 'after' }).catch(reportError) }

  function begin(event: React.PointerEvent<HTMLButtonElement>, item: ChatSession, group?: string) {
    if (event.button !== 0) return
    suppressClick.current = false
    gesture.current = { id: item.id, group, pinned: item.pinned, startX: event.clientX, startY: event.clientY, moving: false }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  function move(event: React.PointerEvent<HTMLButtonElement>) {
    const current = gesture.current
    if (!current) return
    if (!current.moving && Math.hypot(event.clientX - current.startX, event.clientY - current.startY) < 6) return
    current.moving = true; suppressClick.current = true
    setDragging({ id: current.id, group: current.group, pinned: current.pinned, x: event.clientX, y: event.clientY })
    const point = document.elementFromPoint(event.clientX, event.clientY)
    const row = point?.closest<HTMLElement>('[data-chat-tab]'), box = point?.closest<HTMLElement>('[data-chat-group]')
    const item = items.find(entry => entry.id === row?.dataset.chatTab)
    let next: Drop | null = null
    if (current.group) {
      // A group lands beside another group button; its whole run moves, never into the middle of one.
      const other = box ? buckets.find(bucket => bucket.name === box.dataset.chatGroup && bucket.name !== current.group && bucket.items[0].pinned === current.pinned) : undefined
      if (box && other) { const rect = box.getBoundingClientRect(); next = { beside: other.name!, pinned: other.items[0].pinned, targetId: other.items[0].id, position: event.clientX >= rect.left + rect.width / 2 ? 'after' : 'before' } }
    } else if (row && item && item.id !== current.id && item.pinned === current.pinned) {
      const rect = row.getBoundingClientRect()
      next = { id: item.id, position: event.clientY >= rect.top + rect.height / 2 ? 'after' : 'before' }
    } else {
      // A group button accepts the chat as its newest member.
      const bucket = box ? buckets.find(entry => entry.name === box.dataset.chatGroup) : undefined
      if (bucket && !bucket.items.some(entry => entry.id === current.id)) next = { group: bucket.name! }
    }
    drop.current = next; setTarget(next)
  }
  function finish() {
    const current = gesture.current, destination = drop.current
    clear()
    if (!current?.moving || !destination) return
    if (current.group) {
      const targetId = 'beside' in destination ? destination.targetId : null
      if (targetId && 'position' in destination) api('/groups/move', { group: current.group, pinned: current.pinned, targetId, position: destination.position }).catch(reportError)
    }
    else if ('group' in destination) api(`/sessions/${current.id}`, { group: destination.group }, 'PATCH').catch(reportError)
    else if ('id' in destination) api(`/sessions/${current.id}/reorder`, { targetId: destination.id, position: destination.position }).catch(reportError)
  }
  const dragged = dragging?.group ? undefined : items.find(item => item.id === dragging?.id)
  const draggedGroup = dragging?.group ? buckets.find(bucket => bucket.name === dragging.group) : undefined

  const renderRow = (item: ChatSession) => {
    const selected = selectedId === item.id, agent = agents.find(entry => entry.id === item.agent), state = stateText(item)
    return <div key={item.id} data-chat-tab={item.id} className={`chat-picker-row ${selected ? 'selected' : ''} ${item.tabColor ? 'has-color' : ''} ${!dragging?.group && dragging?.id === item.id ? 'dragging' : ''} ${target && 'id' in target && target.id === item.id ? `drop-${target.position}` : ''}`} style={{ '--tab-accent': item.tabColor || 'var(--pink)' } as React.CSSProperties} onContextMenu={event => openMenu(event, { kind: 'tab', item, x: event.clientX, y: event.clientY })}>
      {editing?.id === item.id ? <span className="chat-picker-item chat-picker-editing"><span style={{ color: agent?.color }}><SessionLogo session={item} /></span><input autoFocus value={editing.name} maxLength={100} aria-label="English chat name" onFocus={event => event.currentTarget.select()} onChange={event => setEditing({ id: item.id, name: event.target.value })} onBlur={() => { if (cancelEdit.current) { cancelEdit.current = false; setEditing(null) } else saveName() }}
        onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); else if (event.key === 'Escape') { event.stopPropagation(); cancelEdit.current = true; event.currentTarget.blur() } }} /></span>
      : <button type="button" className="chat-picker-item" aria-current={selected ? 'true' : undefined} aria-label={`${item.name} · ${agent?.label || item.agent} · ${chatActivityLabel(item)}${selected ? ' · current chat' : ''}`}
        title={`${item.name}\n${agent?.label} · ${chatActivityLabel(item)}${item.group ? `\n${item.group}` : ''}\n${item.cwd}\nDrag to reorder ${item.pinned ? 'pinned' : 'unpinned'} chats · right click or the ⋯ button for options`}
        onClick={event => { if (!suppressClick.current || event.detail === 0) pick(item.id) }} onKeyDown={event => { if (event.key === 'F2') { event.preventDefault(); setEditing({ id: item.id, name: item.name }) } }}
        onPointerDown={event => begin(event, item)} onPointerMove={move} onPointerUp={finish} onPointerCancel={clear} onLostPointerCapture={clear}>
        <span className="picker-agent" style={{ color: agent?.color }}><SessionLogo session={item} /></span>
        <span className="picker-text"><span className="chat-picker-name">{item.name}</span><small>{agent?.label}{state ? <> · <b className={`picker-state ${/^Working|^Needs/.test(state) ? 'busy' : ''}`}>{state}</b></> : null}</small></span>
        {item.pinned && <span className="tab-pinned" title="Pinned in History"><Icon name="pin" size={11} /></span>}{selected && <Check />}
      </button>}
      <button type="button" className="chat-picker-more" aria-label={`Options for ${item.name}`} title="Chat options" aria-haspopup="menu" onClick={event => menuFrom(event, (x, y) => ({ kind: 'tab', item, x, y }))}><Dots /></button>
      <button type="button" className="chat-picker-close" onClick={() => closeChat(item)} aria-label={`Close ${item.name}`} title="Close tab · keep in History"><Icon name="close" size={12} /></button>
    </div>
  }

  const heading = picker?.kind === 'more' ? 'More groups' : pickerBuckets[0] ? `${bucketLabel(pickerBuckets[0])} chats` : ''
  const hiddenWorking = hidden.reduce((sum, bucket) => sum + bucket.working, 0), hiddenUnread = hidden.reduce((sum, bucket) => sum + bucket.unread, 0), hiddenChats = hidden.reduce((sum, bucket) => sum + bucket.items.length, 0)
  const moreOpen = picker?.kind === 'more'
  const anyWorking = buckets.some(bucket => bucket.working > 0), anyUnread = buckets.some(bucket => bucket.unread > 0)
  const moreSummary = `${plural(hidden.length, 'more group')} · ${plural(hiddenChats, 'open chat')}${hiddenWorking ? ` · ${hiddenWorking} working` : ''}${hiddenUnread ? ` · ${hiddenUnread} unread` : ''}`
  return <div className={`chat-tabs ${dragging ? 'is-reordering' : ''}`} ref={root}>
    <div className="chat-groups" ref={bar} role="group" aria-label="Chat groups">
      {shown.map(index => {
        const bucket = buckets[index], open = picker?.kind === 'group' && picker.key === bucket.key, label = bucketLabel(bucket)
        const beside = bucket.name && target && 'beside' in target && target.beside === bucket.name ? `drop-${target.position}` : ''
        return <button key={bucket.key} type="button" data-picker-trigger={bucket.key} data-chat-group={bucket.name ?? undefined} className={`chat-group-chip ${active === index ? 'active' : ''} ${open ? 'open' : ''} ${bucket.working ? 'working' : ''} ${draggedGroup?.key === bucket.key ? 'dragging' : ''} ${beside} ${target && 'group' in target && target.group === bucket.name ? 'drop-into' : ''}`} style={{ '--tab-accent': bucket.color } as React.CSSProperties}
          aria-haspopup="true" aria-expanded={open} aria-controls={open ? pickerId : undefined} aria-current={active === index ? 'true' : undefined} aria-label={`${label}${bucket.name ? ' group' : ' chats'} · ${summary(bucket)}${active === index ? ' · current group' : ''}`}
          title={`${label} · ${summary(bucket)}\nOpen to choose a chat${bucket.name ? ' · drag to move the group · right click for group options · drop a chat here to add it' : ''}`}
          onClick={event => { if (!suppressClick.current || event.detail === 0) toggle({ kind: 'group', key: bucket.key }, event.currentTarget) }} onKeyDown={event => triggerKeys(event, { kind: 'group', key: bucket.key })}
          onPointerDown={event => { if (bucket.name) begin(event, bucket.items[0], bucket.name); else suppressClick.current = false }} onPointerMove={move} onPointerUp={finish} onPointerCancel={clear} onLostPointerCapture={clear}
          onContextMenu={event => { if (bucket.name) openMenu(event, { kind: 'group', key: bucket.key, x: event.clientX, y: event.clientY }) }}>
          <Face name={label} count={bucket.items.length} working={bucket.working} unread={bucket.unread} open={open} />
        </button>
      })}
      {hidden.length > 0 && <button type="button" data-picker-trigger={moreKey} className={`chat-group-chip chat-more ${moreOpen ? 'open' : ''}`} style={{ '--tab-accent': '#a6afbc' } as React.CSSProperties} aria-haspopup="true" aria-expanded={moreOpen} aria-controls={moreOpen ? pickerId : undefined} aria-label={`More groups · ${moreSummary}`} title={`More groups · ${moreSummary}`}
        onPointerDown={() => { suppressClick.current = false }} onClick={event => toggle({ kind: 'more' }, event.currentTarget)} onKeyDown={event => triggerKeys(event, { kind: 'more' })}>
        <Face name={moreName} count={hidden.length} working={hiddenWorking} unread={hiddenUnread} open={moreOpen} />
      </button>}
      <div className="chat-groups-probe" ref={probe} aria-hidden="true">
        {buckets.map(bucket => <span key={bucket.key} data-probe="group" className="chat-group-chip"><Face name={bucketLabel(bucket)} count={bucket.items.length} working={bucket.working} unread={bucket.unread} open={false} /></span>)}
        <span data-probe="more" className="chat-group-chip chat-more"><Face name="More" count={Math.max(buckets.length, 1)} working={anyWorking ? 1 : 0} unread={anyUnread ? 1 : 0} open={false} /></span>
        <span data-probe="more-full" className="chat-group-chip chat-more"><Face name="More groups" count={Math.max(buckets.length, 1)} working={anyWorking ? 1 : 0} unread={anyUnread ? 1 : 0} open={false} /></span>
      </div>
    </div>
    {picker && place && pickerBuckets.length > 0 && <div className="chat-picker" id={pickerId} ref={popup} role="group" aria-label={heading} style={{ left: place.left, top: place.top, width: place.width, maxHeight: place.maxHeight }} onKeyDown={pickerKeys}>
      {pickerBuckets.map(bucket => <section key={bucket.key} className="chat-picker-section" aria-label={bucketLabel(bucket)} style={{ '--tab-accent': bucket.color } as React.CSSProperties}>
        <header className="chat-picker-heading"><span className="chat-picker-title" title={bucketLabel(bucket)}>{bucketLabel(bucket)}</span><small>{bucket.items.length}</small>
          {bucket.name && <button type="button" className="chat-picker-group-options" aria-label={`Options for the ${bucket.name} group`} title="Group options" aria-haspopup="menu" onClick={event => menuFrom(event, (x, y) => ({ kind: 'group', key: bucket.key, x, y }))}><Dots /></button>}</header>
        {bucket.items.map(renderRow)}
      </section>)}
    </div>}
    {dragging && dragged && <div className="chat-tab-ghost" style={{ left: dragging.x + 13, top: dragging.y + 13, color: dragged.tabColor || '#d8c9da' }} aria-hidden="true"><SessionLogo session={dragged} /><span>{dragged.name}</span>{dragged.pinned && <Icon name="pin" size={12} />}</div>}
    {dragging && draggedGroup && <div className="chat-tab-ghost group-ghost" style={{ left: dragging.x + 13, top: dragging.y + 13, color: draggedGroup.color }} aria-hidden="true"><span>{draggedGroup.name}</span><small>{draggedGroup.items.length}</small></div>}
    {menu && (menu.kind === 'tab' || menuBucket) && <div className="tab-menu" role="menu" ref={menuBox} onKeyDown={menuKeys} style={{ left: Math.max(4, Math.min(menu.x, window.innerWidth - 260)), top: Math.max(4, Math.min(menu.y, window.innerHeight - (menu.kind === 'tab' ? 520 : 330))) }}>
      {menu.kind === 'tab' ? <>
        <strong>{menu.item.name}</strong>
        {rename === null ? <button type="button" role="menuitem" onClick={() => setRename(menu.item.name)}>Rename chat</button> : <form className="tab-menu-rename" onSubmit={event => { event.preventDefault(); if (rename.trim()) patch(menu.item.id, { name: rename.trim() }) }}><input autoFocus value={rename} maxLength={100} aria-label="English chat name" onChange={event => setRename(event.target.value)} /><button type="submit">Save</button></form>}
        <button type="button" role="menuitem" onClick={() => patch(menu.item.id, { pinned: !menu.item.pinned })}>{menu.item.pinned ? 'Unpin from History' : 'Pin in History'}</button>
        {neighbor(menu.item, -1) && <button type="button" role="menuitem" onClick={() => moveChat(menu.item, -1)}>Move up in the list</button>}
        {neighbor(menu.item, 1) && <button type="button" role="menuitem" onClick={() => moveChat(menu.item, 1)}>Move down in the list</button>}
        <span>Tab color</span>
        <Swatches label="Tab color" value={menu.item.tabColor} onChange={value => patch(menu.item.id, { tabColor: value })} />
        <span>{menu.item.group ? 'Move to group' : 'Add to group'}</span>
        {groups.filter(name => name !== menu.item.group).map(name => <button key={name} type="button" role="menuitem" onClick={() => patch(menu.item.id, { group: name })}>{name}</button>)}
        <form onSubmit={event => { event.preventDefault(); if (draft.trim()) patch(menu.item.id, { group: draft.trim() }) }}><input placeholder="New group…" aria-label="New group name" value={draft} maxLength={60} onChange={event => setDraft(event.target.value)} /><button type="submit" disabled={!draft.trim()}>Add</button></form>
        {menu.item.group && <button type="button" role="menuitem" onClick={() => patch(menu.item.id, { group: null })}>Remove from {menu.item.group}</button>}
        <hr />
        <button type="button" role="menuitem" onClick={() => { setMenu(null); api('/reveal', { path: menu.item.cwd }).catch(reportError) }}>Show working folder</button>
        <button type="button" role="menuitem" title="Clear visible scrollback; keep the agent conversation" onClick={() => { setMenu(null); api(`/sessions/${menu.item.id}/clear`, {}).catch(reportError) }}>Clear terminal scrollback</button>
        <hr />
        <button type="button" role="menuitem" onClick={() => closeChat(menu.item)}>Close tab · keep in History</button>
      </> : menuBucket && <>
        <strong>{menuBucket.name}</strong>
        {rename === null ? <button type="button" role="menuitem" onClick={() => setRename(menuBucket.name)}>Rename group</button> : (() => {
          // Another group's name merges the two, so the button says so.
          const to = rename.trim().replace(/\s+/g, ' ')
          const merge = to !== menuBucket.name && groups.includes(to)
          return <form className="tab-menu-rename" onSubmit={event => { event.preventDefault(); if (to) renameGroup(menuBucket.name!, to) }}><input autoFocus value={rename} maxLength={60} aria-label="English group name" onChange={event => setRename(event.target.value)} /><button type="submit" disabled={!to} title={merge ? `Move these chats into the existing ${to} group` : undefined}>{merge ? 'Merge' : 'Save'}</button></form>
        })()}
        {groupNeighbor(menuBucket, -1) && <button type="button" role="menuitem" onClick={() => moveGroup(menuBucket, -1)}>Move group earlier</button>}
        {groupNeighbor(menuBucket, 1) && <button type="button" role="menuitem" onClick={() => moveGroup(menuBucket, 1)}>Move group later</button>}
        <span>Group color</span>
        <Swatches label="Group color" value={groupColors[menuBucket.name!] || null} onChange={value => { setMenu(null); setGroupColor(menuBucket.name!, value) }} />
        <hr />
        <button type="button" role="menuitem" onClick={() => ungroup(menuBucket)}>Ungroup {plural(menuBucket.items.length, 'chat')}</button>
        {confirm ? (() => {
          // Ungroup only reaches the open chats; deleting also clears the group from History chats and forgets its color.
          const history = historyCounts[menuBucket.name!] || 0
          return <div className="tab-menu-confirm"><p>Remove the {menuBucket.name} group from {plural(menuBucket.items.length, 'open chat')}{history ? ` and ${history} ${history === 1 ? 'chat' : 'chats'} in History` : ''}. The chats stay where they are.</p><button type="button" className="danger" onClick={() => deleteGroup(menuBucket.name!)}>Delete group</button><button type="button" onClick={() => setConfirm(false)}>Cancel</button></div>
        })() : <button type="button" role="menuitem" className="danger" onClick={() => setConfirm(true)}>Delete group…</button>}
      </>}
    </div>}
  </div>
}
