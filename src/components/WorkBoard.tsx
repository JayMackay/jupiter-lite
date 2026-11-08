import { Children, isValidElement, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import Markdown, { type ExtraProps } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import diff from 'highlight.js/lib/languages/diff'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import markdown from 'highlight.js/lib/languages/markdown'
import powershell from 'highlight.js/lib/languages/powershell'
import python from 'highlight.js/lib/languages/python'
import shell from 'highlight.js/lib/languages/shell'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'
import '../styles/work-board.css'
import { dueSoon, nextUp, projectHealth, refinementQueue } from '../lib/work-overview'
import BoardMenu, { type BoardMenuRow } from './BoardMenu'
import { api, isDesktop, reportError, selectChat, useDesktop } from '../desktop/client'
import type { ChatSession } from '../desktop/types'
import {
  COLUMNS, COLUMN_LABELS, LIMITED, LIMIT_RANGE, PRIORITIES, PRIORITY_LABELS, TAG_COLORS, TYPES, TYPE_LABELS, WORK_CHANGED, announceWorkChange, createBoard, deleteBoard, itemsIn, listBoards, loadBoard, loadWeekly, newId, parseUkDay, preferredBoard, rememberBoard, restoreBoard, saveBoard, saveWeekly, ukDate, ukDay,
  type Column, type ItemType, type LimitedColumn, type Priority, type WeeklySummary, type WorkBoardData, type WorkBoardSummaryRow, type WorkItem, type WorkLimits, type WorkTag, type WorkTask,
  moveItem, moveTask, tracking, type ResumeMode, type WorkCycle,
} from '../lib/work'

// `index` places the placeholder among the visible cards; `before` is the card the drop goes in
// front of (null for the end), so a drop lands in the right place even while a filter hides cards.
type Drag = { id: string; dx: number; dy: number; x: number; y: number; width: number; height: number; column: Column; index: number; before: string | null }
type Status = '' | 'saving' | 'saved'
type Patch = (patch: Partial<WorkItem>, immediate?: boolean) => void

const MAX_ITEMS = 300
const MAX_TASKS = 100
const MAX_TEXT = 5000
const MAX_ITEM_TAGS = 20
const MAX_BOARD_TAGS = 100
const MAX_TAG = 40
const UNDO_MS = 8000
const message = (reason: unknown) => reason instanceof Error ? reason.message : String(reason)
const now = () => new Date().toISOString()
// Escape inside an inline field cancels that field only, not the dashboard window around the board.
const keepEscape = (event: ReactKeyboardEvent) => { if (event.key === 'Escape') event.nativeEvent.stopPropagation() }

const ICONS: Record<string, ReactNode> = {
  feature: <><path d="M8 4h8v5a4 4 0 0 1-8 0V4z" /><path d="M8 6H5.5a2.5 2.5 0 0 0 2.6 4M16 6h2.5a2.5 2.5 0 0 1-2.6 4" /><path d="M12 13v4M8.5 20h7" /></>,
  bug: <><path d="M9 7.5V6.5a3 3 0 0 1 6 0v1" /><rect x="7" y="7.5" width="10" height="12.5" rx="5" /><path d="M12 11v9M3.5 10.5L7 12M20.5 10.5L17 12M3.5 15.5H7M20.5 15.5H17M5 20.5l2.6-2.2M19 20.5l-2.6-2.2" /></>,
  spike: <><path d="M9.5 3.5h5M10.3 3.5v6L5.2 18.4A1.7 1.7 0 0 0 6.7 21h10.6a1.7 1.7 0 0 0 1.5-2.6L13.7 9.5v-6" /><path d="M7.6 15h8.8" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  chevron: <path d="M9 6l6 6-6 6" />,
  back: <path d="M15 6l-6 6 6 6" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  trash: <><path d="M4 7h16M10 11v6M14 11v6" /><path d="M6 7l1 13h10l1-13M9 7V4h6v3" /></>,
  flag: <path d="M6 21V4.5M6 4.5h11.5l-2.5 4 2.5 4H6" />,
  calendar: <><rect x="4" y="5.5" width="16" height="14.5" rx="2.5" /><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" /></>,
  bold: <path d="M7 5h5.5a3.5 3.5 0 0 1 0 7H7zM7 12h6.5a3.5 3.5 0 0 1 0 7H7z" />,
  strike: <path d="M4.5 12h15M16 7.5c-.6-1.6-2.1-2.5-4-2.5-2.4 0-4 1.3-4 3 0 1.2.8 2.1 2.2 2.6M8 16.5c.6 1.6 2.1 2.5 4 2.5 2.4 0 4-1.3 4-3 0-.6-.2-1.2-.6-1.6" />,
  italic: <path d="M11 5h6M7 19h6M14 5l-4 14" />,
  heading: <path d="M6 5v14M17 5v14M6 12h11" />,
  bullets: <><path d="M10 6h10M10 12h10M10 18h10" /><circle cx="5" cy="6" r=".9" /><circle cx="5" cy="12" r=".9" /><circle cx="5" cy="18" r=".9" /></>,
  numbers: <path d="M10 6h10M10 12h10M10 18h10M4 4.5L5.5 3.5V8.5M3.8 13.5a1.4 1.4 0 0 1 2.6.7c0 .9-2.6 2.6-2.6 3.3h2.7" />,
  checklist: <path d="M3.5 6.5l1.6 1.6 3-3.1M3.5 14.5l1.6 1.6 3-3.1M11.5 7h8.5M11.5 15h8.5" />,
  code: <path d="M9 8l-4 4 4 4M15 8l4 4-4 4" />,
  codeblock: <><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" /><path d="M10.5 10l-2 2 2 2M13.5 10l2 2-2 2" /></>,
  link: <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
  chat: <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />,
  quote: <path d="M6.5 7.5h4v4c0 3-1.4 4.8-4 5.5M14 7.5h4v4c0 3-1.4 4.8-4 5.5" />,
  week: <><rect x="4" y="5.5" width="16" height="14.5" rx="2.5" /><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4M8 14l2 2 4-4" /></>,
  copy: <><rect x="8.5" y="8.5" width="11" height="11" rx="2.5" /><path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5" /></>,
  save: <><path d="M5 4h11l3 3v13H5z" /><path d="M8.5 4v5h6V4M8.5 20v-6h7v6" /></>,
}
const Icon = ({ name }: { name: keyof typeof ICONS }) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONS[name]}</svg>
const TypeIcon = ({ type }: { type: ItemType }) => <span className={`jh-wb-type is-${type}`} title={TYPE_LABELS[type]}><Icon name={type} /></span>
const PriorityFlag = ({ priority }: { priority: Priority }) => priority === 'none' ? null
  : <span className={`jh-wb-flag is-${priority}`} role="img" aria-label={`${PRIORITY_LABELS[priority]} priority`} title={`${PRIORITY_LABELS[priority]} priority`}><Icon name="flag" /></span>

// "Due 04/11/2026"; amber within 2 days, red when overdue.
function dueInfo(due: string | null, state: Column) {
  if (!due) return null
  const [year, month, day] = due.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const days = Math.round((date.getTime() - today.getTime()) / 86400000)
  const label = `Due ${ukDay(due)}`
  const tone = state === 'done' ? '' : days < 0 ? 'is-late' : days <= 2 ? 'is-soon' : ''
  return { label, tone, hint: tone === 'is-late' ? 'Overdue' : tone === 'is-soon' ? 'Due soon' : 'Due date' }
}
function DueLabel({ due, state }: { due: string | null; state: Column }) {
  const info = dueInfo(due, state)
  return info ? <span className={`jh-wb-due ${info.tone}`} title={info.hint}>{info.label}</span> : null
}

// How long something has been in flight (or took): hours under a day, days under two weeks, then weeks.
function span(ms: number, long: boolean) {
  const hours = Math.max(1, Math.round(ms / 3600000))
  if (hours < 24) return long ? `${hours} ${hours === 1 ? 'hour' : 'hours'}` : `${hours}h`
  const days = Math.round(ms / 86400000)
  if (days < 14) return long ? `${days} ${days === 1 ? 'day' : 'days'}` : `${days}d`
  const weeks = Math.round(days / 7)
  return long ? `${weeks} weeks` : `${weeks}w`
}
// An item's (or task's) time comes from its work cycles: in flight while In progress, the active work
// once Done, paused in Backlog. Backlog time is never counted as work, and the creation date alone never
// counts as a start. The card shows the short form.
type Timed = Pick<WorkItem, 'state' | 'cycles' | 'created' | 'completed'>
function itemTime(item: Timed) {
  const t = tracking(item)
  const created = `Created ${ukDate(item.created)}`
  if (!t.cycles) return { short: '', long: item.state === 'done' ? `${created} · Done${item.completed ? ` ${ukDate(item.completed)}` : ''} with no time in progress` : `${created} · not started yet` }
  const over = t.cycles > 1 ? ` over ${t.cycles} cycles` : ''
  const since = `${span(t.elapsedMs, true)} since it first started`
  if (item.state === 'doing') return { short: span(t.inFlightMs, false), long: `${created} · in progress for ${span(t.inFlightMs, true)}${t.cycles > 1 ? ` (this cycle ${span(t.currentMs, true)})` : ''} · ${span(t.activeMs, true)} active${over} · ${since}` }
  if (item.state === 'done') return { short: span(t.activeMs, false), long: `${created} · Done${item.completed ? ` ${ukDate(item.completed)}` : ''} after ${span(t.activeMs, true)} of active work${over} · ${since}` }
  return { short: '', long: `${created} · paused after ${span(t.activeMs, true)} of active work${over}` }
}
// The card shows the short form ("3d"); the sheet shows the full line.
function ItemTime({ item, full }: { item: Timed; full?: boolean }) {
  const info = itemTime(item)
  if (!full && !info.short) return null
  return <span className={`${full ? 'jh-wb-age-line' : 'jh-wb-age'}${item.state === 'done' ? ' is-done' : ''}`} title={full ? undefined : info.long}>{full ? info.long : info.short}</span>
}

const tagColor = (tags: WorkTag[], name: string) => tags.find(tag => tag.name === name)?.color || 'ice'
const TagChip = ({ name, color, children }: { name: string; color: string; children?: ReactNode }) => <span className={`jh-wb-tag is-${color}`}><span className="jh-wb-tag-name">{name}</span>{children}</span>
// Up to three tags, then "+2" for the rest.
function CardTags({ names, tags }: { names: string[]; tags: WorkTag[] }) {
  if (!names.length) return null
  const rest = names.slice(3)
  return (
    <div className="jh-wb-card-tags">
      {names.slice(0, 3).map(name => <TagChip key={name} name={name} color={tagColor(tags, name)} />)}
      {rest.length > 0 && <span className="jh-wb-tag is-more" title={rest.join(', ')}>+{rest.length}</span>}
    </div>
  )
}

function Progress({ tasks }: { tasks: WorkTask[] }) {
  if (!tasks.length) return null
  const done = tasks.filter(task => task.done).length
  return <span className={`jh-wb-progress${done === tasks.length ? ' is-done' : ''}`} aria-label={`${done} of ${tasks.length} tasks done`}>{done}/{tasks.length}</span>
}

/* ─── Markdown fields ─── */

type Format = 'bold' | 'italic' | 'strike' | 'heading' | 'bullets' | 'numbers' | 'checklist' | 'code' | 'codeblock' | 'link' | 'quote'
const FORMATS: { id: Format; label: string; keys?: string }[] = [
  { id: 'bold', label: 'Bold', keys: 'Ctrl+B' }, { id: 'italic', label: 'Italic', keys: 'Ctrl+I' }, { id: 'strike', label: 'Strikethrough' }, { id: 'heading', label: 'Heading' },
  { id: 'bullets', label: 'Bullets' }, { id: 'numbers', label: 'Numbers' }, { id: 'checklist', label: 'Checklist' },
  { id: 'code', label: 'Code' }, { id: 'codeblock', label: 'Code block' }, { id: 'link', label: 'Link', keys: 'Ctrl+K' }, { id: 'quote', label: 'Quote' },
]
const LINE_PREFIX = /^(#{1,6} |[-*+] \[[ xX]\] |[-*+] |\d+\. |> ?)/
const LINE_FORMATS: Partial<Record<Format, { match: RegExp; prefix: (n: number) => string }>> = {
  heading: { match: /^#{1,6} /, prefix: () => '## ' },
  bullets: { match: /^[-*+] (?!\[[ xX]\] )/, prefix: () => '- ' },
  numbers: { match: /^\d+\. /, prefix: n => `${n + 1}. ` },
  checklist: { match: /^[-*+] \[[ xX]\] /, prefix: () => '- [ ] ' },
  quote: { match: /^> ?/, prefix: () => '> ' },
}

/** Applies a Markdown format to the selection: wraps inline text, or prefixes (or unprefixes) whole lines. */
function formatText(value: string, start: number, end: number, format: Format): { text: string; start: number; end: number } {
  const line = LINE_FORMATS[format]
  if (line) {
    const from = value.lastIndexOf('\n', start - 1) + 1
    const stop = end > start && value[end - 1] === '\n' ? end - 1 : end
    let to = value.indexOf('\n', stop); if (to < 0) to = value.length
    const lines = value.slice(from, to).split('\n')
    const filled = lines.filter(text => text.trim())
    const off = filled.length > 0 && filled.every(text => line.match.test(text))
    let n = 0
    const out = lines.map(text => off ? text.replace(line.match, '') : lines.length > 1 && !text.trim() ? text : line.prefix(n++) + text.replace(LINE_PREFIX, '')).join('\n')
    const text = value.slice(0, from) + out + value.slice(to)
    if (start === end) { const caret = Math.max(from, start + out.length - (to - from)); return { text, start: caret, end: caret } }
    return { text, start: from, end: from + out.length }
  }
  const selected = value.slice(start, end)
  const wrap = (before: string, after: string, fallback: string) => {
    const inner = selected || fallback
    return { text: value.slice(0, start) + before + inner + after + value.slice(end), start: start + before.length, end: start + before.length + inner.length }
  }
  if (format === 'bold') return wrap('**', '**', 'bold text')
  if (format === 'italic') return wrap('_', '_', 'italic text')
  if (format === 'strike') return wrap('~~', '~~', 'struck text')
  if (format === 'code') return wrap('`', '`', 'code')
  if (format === 'codeblock') return wrap(`${start > 0 && value[start - 1] !== '\n' ? '\n' : ''}\`\`\`\n`, `\n\`\`\`${end < value.length && value[end] !== '\n' ? '\n' : ''}`, 'code')
  const before = `[${selected || 'link text'}](`, url = 'https://'
  return { text: value.slice(0, start) + before + url + ')' + value.slice(end), start: start + before.length, end: start + before.length + url.length }
}

// Code blocks are highlighted by language with highlight.js core and only these languages (their
// aliases cover ts, tsx, js, jsx, py, sh, ps1, html, yml, md and so on). Inline code stays plain.
const CODE_LANGUAGES = { bash, css, diff, javascript, json, markdown, powershell, python, shell, sql, typescript, xml, yaml }
for (const [name, language] of Object.entries(CODE_LANGUAGES)) hljs.registerLanguage(name, language)

function CodeBlock({ language, text }: { language: string; text: string }) {
  const [copied, setCopied] = useState(false)
  const known = language && hljs.getLanguage(language) ? language : ''
  // highlight.js escapes the code, so its markup is safe to insert.
  const html = useMemo(() => known ? hljs.highlight(text, { language: known, ignoreIllegals: true }).value : null, [known, text])
  const copy = () => navigator.clipboard.writeText(text).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1400) }, () => { /* the clipboard may be blocked */ })
  return (
    <div className="jh-wb-code">
      <div className="jh-wb-code-head">
        {language && <span className="jh-wb-code-lang">{language}</span>}
        <button type="button" className="jh-wb-code-copy" onClick={copy} aria-label={copied ? 'Copied' : 'Copy code'}>{copied ? 'Copied' : 'Copy'}</button>
      </div>
      {html === null
        ? <pre><code>{text}</code></pre>
        : <pre><code className={`hljs language-${known}`} dangerouslySetInnerHTML={{ __html: html }} /></pre>}
    </div>
  )
}

type MarkdownNode = NonNullable<ExtraProps['node']>
// A fenced block arrives as <pre><code class="language-json">; read its language and raw text.
function codeOf(node: MarkdownNode | undefined) {
  const code = node?.children.find(child => child.type === 'element' && child.tagName === 'code')
  if (!code || code.type !== 'element') return null
  const classes = Array.isArray(code.properties.className) ? code.properties.className.map(String) : []
  const language = classes.find(name => name.startsWith('language-'))?.slice(9).toLowerCase() || ''
  const text = code.children.map(child => child.type === 'text' ? child.value : '').join('').replace(/\n$/, '')
  return { language, text }
}

/** Ticks or unticks the checklist item on a 1 based source line ("- [ ]" and "- [x]"). */
function toggleChecklist(value: string, line: number) {
  const lines = value.split('\n'), at = line - 1
  if (!/^\s*[-*+] \[[ xX]\]/.test(lines[at] ?? '')) return value
  lines[at] = lines[at].replace(/\[([ xX])\]/, (_, mark: string) => mark === ' ' ? '[x]' : '[ ]')
  return lines.join('\n')
}

// Next line's prefix when Enter is pressed inside a list item: checklists, bullets, numbers and quotes carry on.
const LIST_ITEM = /^(\s*)([-*+] \[[ xX]\] |[-*+] |\d+\. |> )/
function continueList(value: string, start: number, end: number): { text: string; caret: number } | null {
  if (start !== end) return null
  const from = value.lastIndexOf('\n', start - 1) + 1
  let to = value.indexOf('\n', start); if (to < 0) to = value.length
  const match = LIST_ITEM.exec(value.slice(from, to))
  if (!match || start < from + match[0].length) return null
  // Enter on an empty item ends the list.
  if (!value.slice(from + match[0].length, to).trim()) return { text: value.slice(0, from) + value.slice(to), caret: from }
  const [, indent, marker] = match
  const number = /^(\d+)\. $/.exec(marker)
  const next = indent + (number ? `${Number(number[1]) + 1}. ` : /\[[ xX]\]/.test(marker) ? marker.replace(/\[[ xX]\]/, '[ ]') : marker)
  return { text: value.slice(0, start) + '\n' + next + value.slice(start), caret: start + 1 + next.length }
}

function MarkdownText({ text, onToggle }: { text: string; onToggle?: (line: number) => void }) {
  return <Markdown remarkPlugins={[remarkGfm]} components={{
    a: ({ href, children }) => <a href={href} target={href?.startsWith('#') ? undefined : '_blank'} rel="noreferrer">{children}</a>,
    pre: ({ node, children }) => { const code = codeOf(node); return code ? <CodeBlock language={code.language} text={code.text} /> : <pre>{children}</pre> },
    // Checklist items look like Tasks: the same check box, and the text in its own column so wrapped lines line up.
    li: ({ node, className, children }) => {
      if (!String(className || '').includes('task-list-item')) return <li className={className}>{children}</li>
      const box = node?.children.find(child => child.type === 'element' && child.tagName === 'input')
      const done = box?.type === 'element' && !!box.properties.checked
      const line = node?.position?.start.line ?? 0
      const rest = Children.toArray(children).filter(child => !(isValidElement(child) && child.type === 'input'))
      return (
        <li className={`task-list-item${done ? ' is-done' : ''}`}>
          <label className="jh-wb-check">
            <input type="checkbox" checked={done} disabled={!onToggle} onChange={() => onToggle?.(line)} aria-label={done ? 'Mark not done' : 'Mark done'} />
            <span aria-hidden="true" />
          </label>
          <span className="jh-wb-md-task">{rest}</span>
        </li>
      )
    },
  }}>{text}</Markdown>
}

// A Markdown text field: the rendered text, or while editing an editor with a compact formatting
// toolbar. Click the preview (or press Enter on it) to edit; leaving the field hides the toolbar
// and previews it again.
function MarkdownField({ label, value, placeholder, onChange, rows = 5 }: { label: string; value: string; placeholder: string; onChange: (value: string) => void; rows?: number }) {
  const [editing, setEditing] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)
  const pending = useRef<{ start: number; end: number } | null>(null)
  useLayoutEffect(() => {
    const selection = pending.current, element = area.current
    if (!selection || !element) return
    pending.current = null
    element.focus()
    element.setSelectionRange(selection.start, selection.end)
  })
  const edit = () => { pending.current = { start: value.length, end: value.length }; setEditing(true) }
  const apply = (format: Format) => {
    const element = area.current
    const start = element ? element.selectionStart : value.length
    const end = element ? element.selectionEnd : value.length
    const next = formatText(value, start, end, format)
    if (next.text.length > MAX_TEXT) return
    pending.current = { start: next.start, end: next.end }
    onChange(next.text)
  }
  return (
    <div className={`jh-wb-md${editing ? ' is-editing' : ''}`} role="group" aria-label={label}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setEditing(false) }}>
      <div className="jh-wb-md-head">
        <span className="jh-wb-md-label">{label}</span>
        {editing && <div className="jh-wb-md-tools" role="toolbar" aria-label={`${label} formatting`}>
          {FORMATS.map(format => (
            <button key={format.id} type="button" className="jh-wb-md-tool" aria-label={format.label} title={format.keys ? `${format.label} (${format.keys})` : format.label}
              onMouseDown={event => event.preventDefault()} onClick={() => apply(format.id)}><Icon name={format.id} /></button>
          ))}
          <span className="jh-wb-md-sep" aria-hidden="true" />
          <button type="button" className="jh-wb-md-mode" onMouseDown={event => event.preventDefault()} onClick={() => setEditing(false)}>Preview</button>
        </div>}
      </div>
      {editing
        ? <textarea ref={area} className="jh-wb-md-edit" value={value} maxLength={MAX_TEXT} aria-label={label} rows={rows} placeholder={placeholder} spellCheck
            onChange={event => onChange(event.target.value)}
            onKeyDown={event => {
              keepEscape(event)
              if (event.key === 'Escape') { setEditing(false); return }
              const key = event.key.toLowerCase()
              const format = (event.ctrlKey || event.metaKey) && !event.altKey ? ({ b: 'bold', i: 'italic', k: 'link' } as Record<string, Format>)[key] : undefined
              if (format) { event.preventDefault(); apply(format); return }
              if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && !event.nativeEvent.isComposing) {
                const element = event.currentTarget, next = continueList(value, element.selectionStart, element.selectionEnd)
                if (next && next.text.length <= MAX_TEXT) { event.preventDefault(); pending.current = { start: next.caret, end: next.caret }; onChange(next.text) }
              }
            }} />
        : <div className={`jh-wb-md-view${value.trim() ? '' : ' is-empty'}`} tabIndex={0} title="Click to edit"
            onClick={event => { if (!(event.target as HTMLElement).closest('a, button, label, input')) edit() }}
            onKeyDown={event => { if (event.key === 'Enter' && event.target === event.currentTarget) { event.preventDefault(); edit() } }}>
            {value.trim() ? <MarkdownText text={value} onToggle={line => onChange(toggleChecklist(value, line))} /> : <span className="jh-wb-md-empty">{placeholder}</span>}
          </div>}
    </div>
  )
}

/* ─── Cards ─── */

// A single line input that adds on Enter, used for new items and new tasks.
function AddLine({ label, placeholder, onAdd, onClose, children }: { label: string; placeholder: string; onAdd: (text: string) => void; onClose: () => void; children?: ReactNode }) {
  const [text, setText] = useState('')
  return (
    <div className="jh-wb-addline">
      <input autoFocus value={text} maxLength={500} placeholder={placeholder} aria-label={label} onChange={event => setText(event.target.value)}
        onKeyDown={event => {
          keepEscape(event)
          if (event.key === 'Enter' && text.trim()) { onAdd(text.trim()); setText('') }
          if (event.key === 'Escape') onClose()
        }}
        onBlur={() => { if (!text.trim()) onClose() }} />
      {children}
    </div>
  )
}

// An item's completed time when it moves to `state`: kept while it stays Done, set on reaching Done, cleared when it leaves.
const completedFor = (item: WorkItem, state: Column) => state !== 'done' ? null : item.state === 'done' && item.completed ? item.completed : now()

function TaskCheck({ task, onChange }: { task: WorkTask; onChange: (patch: Partial<WorkTask>) => void }) {
  return (
    <label className="jh-wb-check">
      <input type="checkbox" checked={task.done} onChange={event => onChange(moveTask(task, event.target.checked ? 'done' : 'todo', now()))} aria-label={`Done: ${task.title}`} />
      <span aria-hidden="true" />
    </label>
  )
}

interface CardProps {
  item: WorkItem; tags: WorkTag[]; expanded: boolean; ghost?: boolean; selected?: boolean
  onToggle?: () => void; onOpen?: (task?: string) => void; onTask?: (id: string, patch: Partial<WorkTask>) => void; onAddTask?: (title: string) => void
  onPointerDown?: (event: ReactPointerEvent<HTMLElement>) => void
}
// Clicking a card's title (or one of its tasks) previews the ticket in the side panel; the full editor opens from there.
function Card({ item, tags, expanded, ghost, selected, onToggle, onOpen, onTask, onAddTask, onPointerDown }: CardProps) {
  const [adding, setAdding] = useState(false)
  return (
    <article className={`jh-wb-card is-${item.type}${ghost ? ' is-ghost' : ''}${selected ? ' is-selected' : ''}`} data-card={ghost ? undefined : item.id} onPointerDown={onPointerDown} aria-label={`${TYPE_LABELS[item.type]}: ${item.title}`}>
      <div className="jh-wb-card-head">
        <TypeIcon type={item.type} />
        <button type="button" className="jh-wb-card-title" onClick={() => onOpen?.()} aria-label={`Preview ${item.title}`} aria-pressed={ghost ? undefined : Boolean(selected)} tabIndex={ghost ? -1 : 0}>{item.title}</button>
        <PriorityFlag priority={item.priority} />
      </div>
      {item.state === 'todo' && <span className={`jh-wb-refine ${item.refined ? 'is-ready' : 'is-needs'}`}>{item.refined ? 'Ready' : 'Needs refinement'}</span>}
      <CardTags names={item.tags} tags={tags} />
      <div className="jh-wb-card-foot">
        <button type="button" className={`jh-wb-icon jh-wb-expand${expanded ? ' is-open' : ''}`} onClick={onToggle} aria-expanded={expanded} aria-label={expanded ? 'Hide tasks' : 'Show tasks'} tabIndex={ghost ? -1 : 0}><Icon name="chevron" /></button>
        <Progress tasks={item.tasks} />
        <DueLabel due={item.due} state={item.state} />
        <ItemTime item={item} />
      </div>
      {expanded && (
        <div className="jh-wb-card-tasks">
          {item.tasks.length > 0 && <ul>{item.tasks.map(task => (
            <li key={task.id} className={`jh-wb-task${task.done ? ' is-done' : ''}`}>
              <TaskCheck task={task} onChange={patch => onTask?.(task.id, patch)} />
              <button type="button" className="jh-wb-task-title" onClick={() => onOpen?.(task.id)} aria-label={`Preview task ${task.title}`} tabIndex={ghost ? -1 : 0}>{task.title}</button>
            </li>
          ))}</ul>}
          {!ghost && (adding
            ? <AddLine label="New task title" placeholder="Task title" onAdd={title => onAddTask?.(title)} onClose={() => setAdding(false)} />
            : item.tasks.length < MAX_TASKS && <button type="button" className="jh-wb-add jh-wb-add-task" onClick={() => setAdding(true)}><Icon name="plus" />Add task</button>)}
        </div>
      )}
    </article>
  )
}

function AddItem({ onAdd }: { onAdd: (title: string, type: ItemType) => void }) {
  const [open, setOpen] = useState(false)
  const [type, setType] = useState<ItemType>('feature')
  if (!open) return <button type="button" className="jh-wb-add" onClick={() => setOpen(true)}><Icon name="plus" />Add item</button>
  return (
    <AddLine label="New item title" placeholder={`${TYPE_LABELS[type]} title`} onAdd={title => onAdd(title, type)} onClose={() => setOpen(false)}>
      <div className="jh-wb-toggle" role="group" aria-label="Item type">
        {TYPES.map(option => (
          <button key={option} type="button" aria-pressed={type === option} className={type === option ? 'is-on' : ''} onMouseDown={event => event.preventDefault()} onClick={() => setType(option)}>
            <TypeIcon type={option} />{TYPE_LABELS[option]}
          </button>
        ))}
      </div>
    </AddLine>
  )
}

// A text input that only commits a non empty value, and puts the old one back if left empty.
function TitleInput({ value, label, className, onCommit }: { value: string; label: string; className: string; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(value)
  return <input className={className} value={draft} maxLength={500} aria-label={label} onChange={event => { setDraft(event.target.value); if (event.target.value.trim()) onCommit(event.target.value.trim()) }}
    onBlur={() => { if (!draft.trim()) setDraft(value) }} onKeyDown={event => { keepEscape(event); if (event.key === 'Enter') event.currentTarget.blur() }} />
}

const StateSelect = ({ value, label, onChange }: { value: Column; label: string; onChange: (state: Column) => void }) => (
  <select className="jh-wb-select" value={value} aria-label={label} onChange={event => onChange(event.target.value as Column)}>
    {COLUMNS.map(column => <option key={column} value={column}>{COLUMN_LABELS[column]}</option>)}
  </select>
)

// The due date typed as DD/MM/YYYY (Enter or leaving saves it, empty clears it), or picked from the
// calendar. The browser's own date field follows the system locale, so it only backs the picker.
function DueField({ value, onChange }: { value: string | null; onChange: (due: string | null) => void }) {
  const shown = value ? ukDay(value) : ''
  const [draft, setDraft] = useState(shown)
  const picker = useRef<HTMLInputElement>(null)
  const commit = () => {
    const text = draft.trim()
    if (!text) { if (value) onChange(null); return }
    const next = parseUkDay(text)
    if (next && next !== value) onChange(next)
    else setDraft(shown)
  }
  const pick = () => {
    const input = picker.current
    if (!input) return
    try { input.showPicker() } catch { input.focus() }
  }
  return (
    <div className="jh-wb-due-field">
      <input className="jh-wb-input" value={draft} maxLength={10} inputMode="numeric" placeholder="DD/MM/YYYY" aria-label="Due date" onChange={event => setDraft(event.target.value)} onBlur={commit}
        onKeyDown={event => { keepEscape(event); if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') setDraft(shown) }} />
      <span className="jh-wb-due-pick">
        <button type="button" className="jh-wb-icon" onClick={pick} aria-label="Pick a due date" title="Pick a date"><Icon name="calendar" /></button>
        <input ref={picker} type="date" className="jh-wb-due-native" tabIndex={-1} aria-hidden="true" value={value || ''} onChange={event => onChange(event.target.value || null)} />
      </span>
      {value && <button type="button" className="jh-wb-icon" onClick={() => onChange(null)} aria-label="Clear due date" title="Clear due date"><Icon name="close" /></button>}
    </div>
  )
}

/* ─── Detail sheet ─── */

// A task in the sheet: checkbox and title; clicking the title expands it to edit its title, state and details.
function SheetTask({ task, open, onToggle, onChange, onRemove }: { task: WorkTask; open: boolean; onToggle: () => void; onChange: (patch: Partial<WorkTask>, immediate?: boolean) => void; onRemove: () => void }) {
  return (
    <li className={`jh-wb-task jh-wb-sheet-task${task.done ? ' is-done' : ''}${open ? ' is-open' : ''}`} data-task={task.id}>
      <div className="jh-wb-task-row">
        <TaskCheck task={task} onChange={onChange} />
        <button type="button" className="jh-wb-task-title" onClick={onToggle} aria-expanded={open}>{task.title}</button>
        {task.state === 'doing' && <span className={`jh-wb-task-state is-${task.state}`}>{COLUMN_LABELS[task.state]}</span>}
        {task.details.trim() && !open && <span className="jh-wb-task-note" title="Has details" aria-hidden="true" />}
        <button type="button" className="jh-wb-icon jh-wb-task-remove" onClick={onRemove} aria-label={`Remove task ${task.title}`}><Icon name="close" /></button>
      </div>
      {open && (
        <div className="jh-wb-task-body">
          <div className="jh-wb-task-fields">
            <TitleInput className="jh-wb-input jh-wb-task-name" label="Task title" value={task.title} onCommit={title => onChange({ title }, false)} />
            <StateSelect value={task.state} label="Task state" onChange={state => onChange(moveTask(task, state, now()))} />
            <ItemTime item={task} full />
          </div>
          <MarkdownField label="Task details" value={task.details} placeholder="Add details for this task" rows={4} onChange={details => onChange({ details }, false)} />
        </div>
      )}
    </li>
  )
}

// The item's tags, each with a small remove button, and an input to pick an existing board tag or
// type a new one and press Enter to create it.
function TagField({ tags, value, onAdd, onRemove }: { tags: WorkTag[]; value: string[]; onAdd: (name: string) => void; onRemove: (name: string) => void }) {
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const key = text.trim().toLowerCase()
  const exact = tags.find(tag => tag.name.toLowerCase() === key)
  const options = tags.filter(tag => !value.includes(tag.name) && (!key || tag.name.toLowerCase().includes(key))).slice(0, 8)
  const canCreate = Boolean(key) && !exact && tags.length < MAX_BOARD_TAGS
  const add = (name: string) => { if (name.trim()) onAdd(name.trim()); setText('') }
  return (
    <div className="jh-wb-tagfield" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false) }}>
      {value.length > 0 && <ul className="jh-wb-tags" aria-label="Item tags">{value.map(name => (
        <li key={name}><TagChip name={name} color={tagColor(tags, name)}>
          <button type="button" className="jh-wb-tag-x" onClick={() => onRemove(name)} aria-label={`Remove tag ${name}`} title="Remove tag"><Icon name="close" /></button>
        </TagChip></li>
      ))}</ul>}
      {value.length < MAX_ITEM_TAGS && <input className="jh-wb-input" value={text} maxLength={MAX_TAG} placeholder={tags.length ? 'Pick or type a tag' : 'Type a tag'} aria-label="Add tag"
        onFocus={() => setOpen(true)} onChange={event => { setText(event.target.value); setOpen(true) }}
        onKeyDown={event => {
          if (event.key === 'Enter' && key && (exact || canCreate)) { event.preventDefault(); add(exact?.name ?? text) }
          if (event.key === 'Backspace' && !text && value.length) onRemove(value[value.length - 1])
        }} />}
      {open && (options.length > 0 || canCreate) && (
        <div className="jh-wb-tag-menu" role="listbox" aria-label="Tag suggestions">
          {options.map(tag => <button key={tag.name} type="button" role="option" aria-selected="false" aria-label={tag.name} onMouseDown={event => event.preventDefault()} onClick={() => add(tag.name)}><TagChip name={tag.name} color={tag.color} /></button>)}
          {canCreate && <button type="button" className="jh-wb-tag-new" onMouseDown={event => event.preventDefault()} onClick={() => add(text)}><Icon name="plus" />Create “{text.trim()}”</button>}
        </div>
      )}
    </div>
  )
}

interface DetailProps { item: WorkItem; tags: WorkTag[]; status: Status; initialTask: string | null; board: ChatBoard; onPatch: Patch; onTag: (name: string) => void; onDelete: () => void; onClose: () => void }
function Detail({ item, tags, status, initialTask, board, onPatch, onTag, onDelete, onClose }: DetailProps) {
  const [confirm, setConfirm] = useState(false)
  const [adding, setAdding] = useState(false)
  const [openTask, setOpenTask] = useState<string | null>(initialTask)
  const taskRef = useRef<HTMLUListElement>(null)
  // Opened from a card's task: bring that task into view.
  useEffect(() => { if (initialTask) taskRef.current?.querySelector(`[data-task="${CSS.escape(initialTask)}"]`)?.scrollIntoView({ block: 'nearest' }) }, [initialTask])
  const setTask = (id: string, patch: Partial<WorkTask>, immediate = true) => onPatch({ tasks: item.tasks.map(task => task.id === id ? { ...task, ...patch } : task) }, immediate)
  return (
    <div className="jh-wb-sheet-wrap" onPointerDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <section className="jh-wb-sheet" role="dialog" aria-modal="true" aria-label={`Details for ${item.title}`}>
        <header className="jh-wb-sheet-head">
          <TypeIcon type={item.type} />
          <TitleInput className="jh-wb-sheet-title" label="Item title" value={item.title} onCommit={title => onPatch({ title })} />
          <span className="jh-wb-status" aria-live="polite">{status === 'saving' ? 'Saving' : status === 'saved' ? 'Saved' : ''}</span>
          <button type="button" className="jh-wb-icon" onClick={onClose} aria-label="Close details"><Icon name="close" /></button>
        </header>
        <div className="jh-wb-sheet-body">
          <div className="jh-wb-sheet-main">
            <label className="jh-wb-refined">
              <span className="jh-wb-check"><input type="checkbox" checked={item.refined} onChange={event => onPatch({ refined: event.target.checked }, true)} aria-label="Refined" /><span aria-hidden="true" /></span>
              <b>Refined</b><small>{item.refined ? 'Ready to start' : 'Needs refinement: add details and acceptance criteria, then tick when it is ready'}</small>
            </label>
            <MarkdownField label="Details" value={item.details} placeholder="Add details" onChange={details => onPatch({ details })} rows={7} />
            <MarkdownField label="Acceptance criteria" value={item.acceptance} placeholder="Add acceptance criteria" onChange={acceptance => onPatch({ acceptance })} />
            <div className="jh-wb-area">
              <span>Tasks <Progress tasks={item.tasks} /></span>
              {item.tasks.length > 0 && <ul className="jh-wb-sheet-tasks" ref={taskRef}>{item.tasks.map(task => (
                <SheetTask key={task.id} task={task} open={openTask === task.id} onToggle={() => setOpenTask(current => current === task.id ? null : task.id)}
                  onChange={(patch, immediate) => setTask(task.id, patch, immediate)} onRemove={() => onPatch({ tasks: item.tasks.filter(other => other.id !== task.id) })} />
              ))}</ul>}
              {adding
                ? <AddLine label="New task title" placeholder="Task title" onAdd={title => onPatch({ tasks: [...item.tasks, { id: newId('t'), title, done: false, state: 'todo', details: '', created: now(), completed: null, cycles: [] }] })} onClose={() => setAdding(false)} />
                : item.tasks.length < MAX_TASKS && <button type="button" className="jh-wb-add" onClick={() => setAdding(true)}><Icon name="plus" />Add task</button>}
            </div>
          </div>
          <aside className="jh-wb-fields">
            <label><span>Type</span>
              <select className="jh-wb-select" value={item.type} aria-label="Type" onChange={event => onPatch({ type: event.target.value as ItemType })}>
                {TYPES.map(type => <option key={type} value={type}>{TYPE_LABELS[type]}</option>)}
              </select>
            </label>
            <label><span>State</span><StateSelect value={item.state} label="State" onChange={state => onPatch({ state })} /></label>
            <label><span>Priority</span>
              <select className="jh-wb-select" value={item.priority} aria-label="Priority" onChange={event => onPatch({ priority: event.target.value as Priority })}>
                {PRIORITIES.map(priority => <option key={priority} value={priority}>{PRIORITY_LABELS[priority]}</option>)}
              </select>
            </label>
            <div className="jh-wb-field"><span>Due</span>
              <DueField key={item.due || ''} value={item.due} onChange={due => onPatch({ due })} />
            </div>
            <div className="jh-wb-field"><span>Tags</span>
              <TagField tags={tags} value={item.tags} onAdd={onTag} onRemove={name => onPatch({ tags: item.tags.filter(other => other !== name) })} />
            </div>
          </aside>
        </div>
        <footer className="jh-wb-sheet-foot">
          <ItemTime item={item} full />
          <span className="jh-wb-spacer" />
          {/* Opens a conversation about the item. It changes nothing on the ticket; starting work is a separate step. */}
          {!confirm && <StartChat item={item} board={board} />}
          {confirm
            ? <><span>Delete this item?</span><button type="button" className="jh-wb-danger" onClick={onDelete}>Confirm delete</button><button type="button" className="jh-wb-quiet" onClick={() => setConfirm(false)}>Keep</button></>
            : <button type="button" className="jh-wb-quiet jh-wb-delete" onClick={() => setConfirm(true)}><Icon name="trash" />Delete item</button>}
        </footer>
      </section>
    </div>
  )
}

/* ─── Start a chat on an item ─── */

type ChatBoard = { title: string; slug: string; project: string | null }

// Opening a conversation about a ticket is not a request to work on it: the agent reads the ticket,
// says so briefly and waits for the next instruction. The file and item id are there so it can edit
// the ticket when asked to.
function chatPrompt(item: WorkItem, board: ChatBoard) {
  const lines = [`This is a ${TYPE_LABELS[item.type].toLowerCase()} from my Jupiter work board "${board.title}"${board.project ? ` (project: ${board.project})` : ''} (file: knowledge/work/${board.slug}.json, item id ${item.id}). It is context for our conversation, not a request to do anything yet.`, '', `# ${item.title}`, '',
    `State: ${COLUMN_LABELS[item.state]}${item.priority !== 'none' ? ` · Priority: ${PRIORITY_LABELS[item.priority]}` : ''}${item.due ? ` · Due: ${item.due}` : ''}${item.tags.length ? ` · Tags: ${item.tags.join(', ')}` : ''}`]
  if (item.details.trim()) lines.push('', '## Details', '', item.details.trim())
  if (item.acceptance.trim()) lines.push('', '## Acceptance criteria', '', item.acceptance.trim())
  if (item.tasks.length) lines.push('', '## Tasks', '', ...item.tasks.flatMap(task => [`- [${task.done ? 'x' : ' '}] ${task.title} (${COLUMN_LABELS[task.state]})`, ...(task.details.trim() ? [task.details.trim().split('\n').map(row => `  ${row}`).join('\n')] : [])]))
  lines.push('', 'Please read the ticket above, reply with a short acknowledgement of one or two sentences saying what it is about, then wait for me to tell you what to do next. Do not start work, investigate, research, fix or implement anything, and do not change the ticket, its tasks, its acceptance checkboxes or any files until I ask. Unchecked acceptance criteria and tasks are context, not instructions. If I ask you to add details, refine the ticket, plan it or start on it, do that then.')
  return lines.join('\n')
}

function StartChat({ item, board }: { item: WorkItem; board: ChatBoard }) {
  const desktop = useDesktop()
  const [agent, setAgent] = useState<'claude' | 'codex'>(() => desktop.settings.defaultAgent === 'claude' ? 'claude' : 'codex')
  const [busy, setBusy] = useState(false)
  if (!isDesktop) return null
  const start = async () => {
    setBusy(true)
    try {
      const session = await api<ChatSession>('/sessions', { agent, name: item.title.slice(0, 60) || 'Work item', initialPrompt: chatPrompt(item, board) })
      selectChat(session.id); window.dispatchEvent(new Event('jupiter-show-chats'))
    } catch (error) { reportError(error) } finally { setBusy(false) }
  }
  return <span className="jh-wb-chat">
    <button type="button" className="jh-wb-primary" disabled={busy} onClick={() => void start()}><Icon name="chat" />{busy ? 'Starting…' : 'Start a chat on this'}</button>
    <select className="jh-wb-select" value={agent} aria-label="Agent for the chat" onChange={event => setAgent(event.target.value as 'claude' | 'codex')}><option value="codex">Codex</option><option value="claude">Claude Code</option></select>
  </span>
}

/* ─── Project overview and ticket inspector ─── */

// The panel right of the three columns: the project overview until a ticket is selected, then that
// ticket's preview with quick actions. It collapses to a slim rail; the choice is remembered on this device.
const PANEL_KEY = 'jupiter.work.panel'
const panelWasOpen = () => { try { return localStorage.getItem(PANEL_KEY) !== 'closed' } catch { return true } }
const rememberPanel = (open: boolean) => { try { localStorage.setItem(PANEL_KEY, open ? 'open' : 'closed') } catch { /* storage may be blocked */ } }
const SHORT_LIST = 5

// A list entry that previews the ticket.
function PanelRow({ item, onSelect, children }: { item: WorkItem; onSelect: (id: string) => void; children?: ReactNode }) {
  return (
    <button type="button" className="jh-wb-ov-row" onClick={() => onSelect(item.id)} aria-label={`Preview ${item.title}`}>
      <TypeIcon type={item.type} />
      <span className="jh-wb-ov-title">{item.title}</span>
      <PriorityFlag priority={item.priority} />
      {children}
    </button>
  )
}

function Overview({ items, onSelect, onStart }: { items: WorkItem[]; onSelect: (id: string) => void; onStart: (item: WorkItem) => void }) {
  const health = projectHealth(items), ready = nextUp(items), refine = refinementQueue(items), deadlines = dueSoon(items)
  const more = (count: number, what: string) => count > SHORT_LIST ? <p className="jh-wb-muted">{count - SHORT_LIST} more {what}</p> : null
  return (
    <>
      <section className="jh-wb-ov" aria-label="Project health">
        <h4>Project health</h4>
        {health.total === 0
          ? <p className="jh-wb-muted">No tickets yet. Add a feature, bug or spike to the Backlog and its progress shows here.</p>
          : <>
              <p className="jh-wb-health-line"><span><strong>{health.done}</strong> of {health.total} {health.total === 1 ? 'ticket' : 'tickets'} done</span><b>{health.percent}%</b></p>
              <div className="jh-wb-meter" role="progressbar" aria-label="Tickets done" aria-valuemin={0} aria-valuemax={100} aria-valuenow={health.percent}><span style={{ width: `${health.percent}%` }} /></div>
              <dl className="jh-wb-health-stats">
                <div><dt>In progress</dt><dd>{health.doing}</dd></div>
                <div><dt>Backlog</dt><dd>{health.backlog}</dd></div>
                <div><dt>Needs refinement</dt><dd>{health.needsRefinement}</dd></div>
              </dl>
            </>}
      </section>
      <section className="jh-wb-ov" aria-label="Next up">
        <h4>Next up<span className="jh-wb-ov-count">{ready.length}</span></h4>
        {ready.length
          ? <ul className="jh-wb-ov-list">{ready.slice(0, SHORT_LIST).map(item => (
              <li key={item.id} className="jh-wb-ov-item">
                <PanelRow item={item} onSelect={onSelect}><DueLabel due={item.due} state={item.state} /></PanelRow>
                <button type="button" className="jh-wb-ov-start" onClick={() => onStart(item)} aria-label={`Start work on ${item.title}`}>Start</button>
              </li>))}</ul>
          : <p className="jh-wb-muted">{health.backlog ? 'Nothing is ready yet. Refine a ticket to line it up.' : 'The Backlog is empty.'}</p>}
        {more(ready.length, 'ready')}
      </section>
      <section className="jh-wb-ov" aria-label="Refinement queue">
        <h4>Refinement queue<span className="jh-wb-ov-count">{refine.length}</span></h4>
        {refine.length
          ? <ul className="jh-wb-ov-list">{refine.slice(0, SHORT_LIST).map(item => <li key={item.id}><PanelRow item={item} onSelect={onSelect} /></li>)}</ul>
          : <p className="jh-wb-muted">{health.backlog ? 'Every Backlog ticket is ready.' : 'Nothing is waiting to be refined.'}</p>}
        {more(refine.length, 'to refine')}
      </section>
      <section className="jh-wb-ov" aria-label="Due soon">
        <h4>Due soon<span className="jh-wb-ov-count">{deadlines.length}</span></h4>
        {deadlines.length
          ? <ul className="jh-wb-ov-list">{deadlines.slice(0, SHORT_LIST).map(({ item, days, overdue }) => (
              <li key={item.id}><PanelRow item={item} onSelect={onSelect}>
                <span className={`jh-wb-due ${overdue ? 'is-late' : days <= 2 ? 'is-soon' : ''}`}>{overdue ? 'Overdue' : 'Due'} {ukDay(item.due as string)}</span>
              </PanelRow></li>))}</ul>
          : <p className="jh-wb-muted">No upcoming deadlines. Give a ticket a due date and it shows here.</p>}
        {more(deadlines.length, 'with deadlines')}
      </section>
    </>
  )
}

interface InspectorProps {
  item: WorkItem; tags: WorkTag[]; focusTask: string | null
  onState: (item: WorkItem, state: Column) => void; onRefined: (item: WorkItem) => void; onAcceptance: (item: WorkItem, acceptance: string) => void; onTask: (item: WorkItem, id: string, patch: Partial<WorkTask>) => void; onEdit: () => void
}
// The selected ticket: details, acceptance criteria, tasks and refinement status, with the quick actions
// that use the board's own workflow (moving a ticket asks the usual question when it has been In progress before).
function Inspector({ item, tags, focusTask, onState, onRefined, onAcceptance, onTask, onEdit }: InspectorProps) {
  return (
    <div className="jh-wb-insp">
      <div className="jh-wb-insp-title"><TypeIcon type={item.type} /><h3>{item.title}</h3><PriorityFlag priority={item.priority} /></div>
      <div className="jh-wb-insp-meta">
        <span className={`jh-wb-state is-${item.state}`}>{COLUMN_LABELS[item.state]}</span>
        {item.state === 'todo' && <span className={`jh-wb-refine ${item.refined ? 'is-ready' : 'is-needs'}`}>{item.refined ? 'Ready' : 'Needs refinement'}</span>}
        <DueLabel due={item.due} state={item.state} />
      </div>
      {item.tags.length > 0 && <ul className="jh-wb-tags" aria-label="Tags">{item.tags.map(name => <li key={name}><TagChip name={name} color={tagColor(tags, name)} /></li>)}</ul>}
      <ItemTime item={item} full />
      <div className="jh-wb-insp-actions" role="group" aria-label="Quick actions">
        {item.state === 'todo' && (item.refined
          ? <button type="button" className="jh-wb-primary" onClick={() => onState(item, 'doing')}>Start work</button>
          : <button type="button" className="jh-wb-primary" onClick={() => onRefined(item)}>Mark as refined</button>)}
        {item.state === 'doing' && <>
          <button type="button" className="jh-wb-primary" onClick={() => onState(item, 'done')}>Mark done</button>
          <button type="button" className="jh-wb-quiet" onClick={() => onState(item, 'todo')}>Back to Backlog</button>
        </>}
        {item.state === 'done' && <button type="button" className="jh-wb-quiet" onClick={() => onState(item, 'doing')}>Reopen</button>}
        <button type="button" className="jh-wb-quiet" onClick={onEdit}>Open full editor</button>
      </div>
      <section className="jh-wb-insp-section" aria-label="Details">
        <h4>Details</h4>
        {item.details.trim() ? <div className="jh-wb-md-view jh-wb-insp-md"><MarkdownText text={item.details} /></div> : <p className="jh-wb-muted">No details yet.</p>}
      </section>
      <section className="jh-wb-insp-section" aria-label="Acceptance criteria">
        <h4>Acceptance criteria</h4>
        {item.acceptance.trim() ? <div className="jh-wb-md-view jh-wb-insp-md"><MarkdownText text={item.acceptance} onToggle={line => onAcceptance(item, toggleChecklist(item.acceptance, line))} /></div> : <p className="jh-wb-muted">No acceptance criteria yet.</p>}
      </section>
      <section className="jh-wb-insp-section" aria-label="Tasks">
        <h4>Tasks <Progress tasks={item.tasks} /></h4>
        {item.tasks.length
          ? <ul className="jh-wb-insp-tasks">{item.tasks.map(task => (
              <li key={task.id} className={`jh-wb-task${task.done ? ' is-done' : ''}${focusTask === task.id ? ' is-focus' : ''}`}>
                <TaskCheck task={task} onChange={patch => onTask(item, task.id, patch)} />
                <span className="jh-wb-task-title">{task.title}</span>
                {task.state === 'doing' && <span className="jh-wb-task-state is-doing">{COLUMN_LABELS[task.state]}</span>}
              </li>))}</ul>
          : <p className="jh-wb-muted">No tasks yet.</p>}
      </section>
    </div>
  )
}

interface PanelProps extends Omit<InspectorProps, 'item'> {
  items: WorkItem[]; item: WorkItem | undefined; open: boolean
  onToggle: () => void; onSelect: (id: string) => void; onBack: () => void
}
function SidePanel({ items, item, open, onToggle, onSelect, onBack, ...actions }: PanelProps) {
  const toggle = useRef<HTMLButtonElement>(null)
  const toggled = useRef(false)
  // The toggle is a different button once the panel is collapsed, so give focus back to it after the change.
  useEffect(() => { if (toggled.current) { toggled.current = false; toggle.current?.focus() } }, [open])
  const label = item ? 'Ticket inspector' : 'Project overview'
  return (
    <aside className={`jh-wb-panel${open ? '' : ' is-collapsed'}`} aria-label={label}
      onKeyDown={event => { if (event.key === 'Escape' && item && open) { keepEscape(event); onBack() } }}>
      <header className="jh-wb-panel-head">
        {open && (item
          ? <button type="button" className="jh-wb-quiet jh-wb-panel-back" onClick={onBack}><Icon name="back" />Back to overview</button>
          : <h3>Project overview</h3>)}
        <button ref={toggle} type="button" className="jh-wb-icon jh-wb-panel-toggle" aria-expanded={open} aria-label={open ? 'Collapse panel' : 'Expand panel'} title={open ? 'Collapse panel' : 'Expand panel'}
          onClick={() => { toggled.current = true; onToggle() }}><Icon name={open ? 'chevron' : 'back'} /></button>
        {!open && <span className="jh-wb-panel-rail" aria-hidden="true">{label}</span>}
      </header>
      {open && <div key={item?.id ?? 'overview'} className="jh-wb-panel-body">
        {item ? <Inspector item={item} {...actions} /> : <Overview items={items} onSelect={onSelect} onStart={start => actions.onState(start, 'doing')} />}
      </div>}
    </aside>
  )
}

/* ─── Work in progress limits ─── */

const DEFAULT_LIMITS: WorkLimits = { doing: 3 }
const isLimited = (column: Column): column is LimitedColumn => (LIMITED as Column[]).includes(column)

// The column count. With a limit, In progress shows "count/limit" against the whole
// column (not the filter); without one they follow the filter like the others. Click to set the
// limit: Enter saves, empty clears, Escape or leaving cancels.
function ColumnCount({ column, shown, total, limit, onLimit }: { column: Column; shown: number; total: number; limit: number | null; onLimit: (value: number | null) => void }) {
  const [editing, setEditing] = useState(false)
  if (!isLimited(column)) return <span className="jh-wb-count">{shown}</span>
  const label = `${COLUMN_LABELS[column]} limit`
  if (editing) return (
    <input className="jh-wb-limit-input" type="number" autoFocus min={LIMIT_RANGE.min} max={LIMIT_RANGE.max} step={1} defaultValue={limit ?? ''} placeholder="None" aria-label={label}
      onFocus={event => event.currentTarget.select()} onBlur={() => setEditing(false)}
      onKeyDown={event => {
        keepEscape(event)
        if (event.key === 'Escape') { event.preventDefault(); setEditing(false) }
        if (event.key !== 'Enter') return
        event.preventDefault()
        const text = event.currentTarget.value.trim()
        const number = Math.round(Number(text))
        if (text && !Number.isFinite(number)) return
        onLimit(text ? Math.min(LIMIT_RANGE.max, Math.max(LIMIT_RANGE.min, number)) : null)
        setEditing(false)
      }} />
  )
  return (
    <button type="button" className="jh-wb-count jh-wb-limit" onClick={() => setEditing(true)} aria-label={limit === null ? `${shown} items, set ${label.toLowerCase()}` : `${total} of ${limit} items, change ${label.toLowerCase()}`}
      title={limit === null ? 'Set a limit' : 'Change the limit'}>{limit === null ? shown : `${total}/${limit}`}</button>
  )
}

/* ─── Calendar and weekly Done summary ─── */

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

const DAY_MS = 86400000
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MONTH_LANES = 3
const MONTH_NAME = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' })
const DAY_MONTH = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit' })
const startOfDay = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate())
const addDays = (value: Date, days: number) => new Date(value.getFullYear(), value.getMonth(), value.getDate() + days)
const firstOfMonth = (value: Date) => new Date(value.getFullYear(), value.getMonth(), 1)
const addMonths = (value: Date, months: number) => new Date(value.getFullYear(), value.getMonth() + months, 1)
/** Monday of the UK week (Monday to Sunday) holding `value`. */
const mondayOf = (value: Date) => addDays(startOfDay(value), -((value.getDay() + 6) % 7))
/** Whole calendar days from a to b (rounded, so a clock change does not shift it). */
const dayDiff = (a: Date, b: Date) => Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / DAY_MS)

// One item's piece of a week row: day columns `from` to `to` (0 is Monday) in lane `lane`.
// `head`/`tail` say whether the item starts/ends inside this row (otherwise it carries on).
interface Segment { item: WorkItem; cycle: WorkCycle; key: string; from: number; to: number; lane: number; head: boolean; tail: boolean }

/**
 * The calendar shows work, not tickets: one bar per work cycle, from the day it entered In progress
 * to the day it left (or today while it runs). Backlog items, including paused ones, are left out;
 * their cycles stay in the item's history. Bars are stacked in lanes so bars that share a day never
 * overlap, longest first like a calendar.
 */
function weekSegments(items: WorkItem[], monday: Date, today: Date): Segment[] {
  const sunday = addDays(monday, 6)
  const spans = items.filter(item => item.state !== 'todo').flatMap(item => (item.cycles || []).flatMap((cycle, index) => {
    const start = startOfDay(new Date(cycle.start))
    if (Number.isNaN(start.getTime())) return []
    let end = startOfDay(cycle.end ? new Date(cycle.end) : today)
    if (Number.isNaN(end.getTime()) || end < start) end = start
    if (end < monday || start > sunday) return []
    return [{ item, cycle, key: `${item.id}-${index}`, from: Math.max(0, dayDiff(monday, start)), to: Math.min(6, dayDiff(monday, end)), head: start >= monday, tail: end <= sunday }]
  })).sort((a, b) => a.from - b.from || (b.to - b.from) - (a.to - a.from) || a.cycle.start.localeCompare(b.cycle.start))
  const lanes: number[] = []
  return spans.map(span => {
    let lane = lanes.findIndex(end => end < span.from)
    if (lane < 0) { lane = lanes.length; lanes.push(span.to) } else lanes[lane] = span.to
    return { ...span, lane }
  })
}

const barLabel = (item: WorkItem, cycle: WorkCycle) => `${TYPE_LABELS[item.type]}: ${item.title}, in progress ${ukDate(cycle.start)} to ${cycle.end ? ukDate(cycle.end) : 'now'}${item.state === 'done' && item.completed ? `, done ${ukDate(item.completed)}` : ''}`

interface WeekRowProps { monday: Date; items: WorkItem[]; today: Date; month: number | null; focused: boolean; onOpen: (id: string) => void; onPickWeek?: (monday: Date) => void }
// A week row: seven day cells behind, the item bars in front on the same grid. In month view
// (`month` set) only MONTH_LANES lanes show and each day counts what is left as "+N more".
function WeekRow({ monday, items, today, month, focused, onOpen, onPickWeek }: WeekRowProps) {
  const segments = weekSegments(items, monday, today)
  const cap = month === null ? Infinity : MONTH_LANES
  const shown = segments.filter(segment => segment.lane < cap)
  const lanes = shown.reduce((most, segment) => Math.max(most, segment.lane + 1), 0)
  const days = WEEKDAYS.map((_, index) => addDays(monday, index))
  return (
    <div className={`jh-wb-cal-week${focused ? ' is-focus' : ''}`} role="row" style={{ gridTemplateRows: `${month === null ? 34 : 26}px repeat(${lanes}, ${month === null ? 30 : 22}px) minmax(${month === null ? 24 : 18}px, 1fr)` }}>
      {days.map((day, index) => {
        const more = segments.filter(segment => segment.lane >= cap && segment.from <= index && segment.to >= index).length
        const classes = `jh-wb-cal-day${dayDiff(day, today) === 0 ? ' is-today' : ''}${month !== null && day.getMonth() !== month ? ' is-out' : ''}${index > 4 ? ' is-weekend' : ''}`
        return (
          <div key={index} className={classes} role="gridcell" aria-label={ukDate(day)} style={{ gridColumn: index + 1 }} onClick={onPickWeek ? () => onPickWeek(monday) : undefined}>
            <span className="jh-wb-cal-date">{month === null ? DAY_MONTH.format(day) : day.getDate()}</span>
            {more > 0 && <span className="jh-wb-cal-more">+{more} more</span>}
          </div>
        )
      })}
      {shown.map(({ item, cycle, key, from, to, lane, head, tail }) => (
        <button key={key} type="button" className={`jh-wb-cal-bar is-${item.type}${head ? '' : ' is-cont-left'}${tail ? '' : ' is-cont-right'}${cycle.end ? ' is-done' : ''}`}
          style={{ gridColumn: `${from + 1} / ${to + 2}`, gridRow: lane + 2 }} title={barLabel(item, cycle)} aria-label={barLabel(item, cycle)} data-item={item.id}
          onClick={event => { event.stopPropagation(); onOpen(item.id) }}>
          {(head || from === 0) && <Icon name={item.type} />}<span>{item.title}</span>
        </button>
      ))}
    </div>
  )
}

interface CalendarProps { slug: string; items: WorkItem[]; tags: WorkTag[]; settle: () => Promise<unknown>; onOpen: (id: string) => void; onClose: () => void }
/**
 * The work calendar: a UK week (Monday to Sunday) or a month of six weeks, each item drawn as a bar
 * for each stretch it was in progress. Below it, the Done summary for the focused week, computed by the service so
 * the sheet, the copied Markdown and the saved file all match. `settle` saves pending board changes first.
 */
function CalendarSheet({ slug, items, tags, settle, onOpen, onClose }: CalendarProps) {
  const [today] = useState(() => startOfDay(new Date()))
  const [view, setView] = useState<'week' | 'month'>('week')
  const [focus, setFocus] = useState(() => mondayOf(today))
  const [month, setMonth] = useState(() => firstOfMonth(today))
  const [data, setData] = useState<WeeklySummary | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const request = useRef(0)
  const thisMonday = mondayOf(today)
  const offsetOf = useCallback((monday: Date) => Math.round(dayDiff(monday, mondayOf(today)) / 7), [today])
  const offset = offsetOf(focus)
  const fetchWeek = useCallback((weeks: number) => {
    const id = ++request.current
    return settle().then(() => loadWeekly(slug, weeks)).then(next => { if (request.current === id) setData(next) })
      .catch(reason => { if (request.current === id) setNote(message(reason)) })
  }, [slug, settle])
  useEffect(() => { void fetchWeek(0) }, [fetchWeek])
  // Moves the focused week (and the month shown), fetching that week's summary when it changes.
  const go = (monday: Date, shownMonth: Date) => {
    setMonth(shownMonth)
    if (monday.getTime() === focus.getTime()) return
    setFocus(monday); setNote(''); void fetchWeek(offsetOf(monday))
  }
  const step = (direction: 1 | -1) => {
    if (view === 'week') { const monday = addDays(focus, 7 * direction); go(monday, firstOfMonth(addDays(monday, 3))); return }
    const next = addMonths(month, direction)
    go(today.getFullYear() === next.getFullYear() && today.getMonth() === next.getMonth() ? thisMonday : mondayOf(next), next)
  }
  // Month view opens on today's month for this week, otherwise on the month holding most of the week.
  const show = (next: 'week' | 'month') => { if (next === 'month') setMonth(firstOfMonth(focus.getTime() === thisMonday.getTime() ? today : addDays(focus, 3))); setView(next) }
  const current = data && data.offsetWeeks === offset ? data : null
  const copy = () => {
    if (!current) return
    navigator.clipboard.writeText(current.markdown).then(() => setNote('Copied'), () => setNote('Could not copy'))
  }
  const save = () => {
    setBusy(true)
    saveWeekly(slug, offset).then(() => setNote('Saved to knowledge'), reason => setNote(message(reason))).finally(() => setBusy(false))
  }
  const unit = view === 'week' ? 'week' : 'month'
  const gridStart = view === 'week' ? focus : mondayOf(month)
  const rows = view === 'week' ? [focus] : Array.from({ length: 6 }, (_, index) => addDays(gridStart, index * 7))
  const range = view === 'week'
    ? `${ukDate(focus)} to ${ukDate(addDays(focus, 6))}`
    : `${MONTH_NAME.format(month)} · ${ukDate(month)} to ${ukDate(addDays(addMonths(month, 1), -1))}`
  const atToday = view === 'week' ? focus.getTime() === thisMonday.getTime() : month.getTime() === firstOfMonth(today).getTime() && focus.getTime() === thisMonday.getTime()
  return (
    <div className="jh-wb-sheet-wrap" onPointerDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <section className="jh-wb-sheet jh-wb-week" role="dialog" aria-modal="true" aria-label="Weekly summary">
        <header className="jh-wb-sheet-head jh-wb-cal-head">
          <span className="jh-wb-week-icon"><Icon name="week" /></span>
          <div className="jh-wb-toggle jh-wb-cal-view" role="group" aria-label="Calendar view">
            {(['week', 'month'] as const).map(option => <button key={option} type="button" aria-pressed={view === option} className={view === option ? 'is-on' : ''} onClick={() => show(option)}>{option === 'week' ? 'Week' : 'Month'}</button>)}
          </div>
          <div className="jh-wb-cal-nav">
            <button type="button" className="jh-wb-icon jh-wb-cal-prev" onClick={() => step(-1)} aria-label={`Previous ${unit}`} title={`Previous ${unit}`}><Icon name="chevron" /></button>
            <button type="button" className="jh-wb-icon" onClick={() => step(1)} aria-label={`Next ${unit}`} title={`Next ${unit}`}><Icon name="chevron" /></button>
            <button type="button" className="jh-wb-quiet jh-wb-cal-today" disabled={atToday} onClick={() => go(thisMonday, firstOfMonth(today))}>Today</button>
          </div>
          <span className="jh-wb-week-range jh-wb-cal-range">{range}</span>
          <span className="jh-wb-spacer" />
          <button type="button" className="jh-wb-icon" onClick={onClose} aria-label="Close summary"><Icon name="close" /></button>
        </header>
        <div className="jh-wb-week-body">
          <div className={`jh-wb-cal is-${view}`} role="grid" aria-label={view === 'week' ? 'Week calendar' : 'Month calendar'}>
            <div className="jh-wb-cal-names" role="row">{WEEKDAYS.map(name => <span key={name} role="columnheader">{name}</span>)}</div>
            {rows.map(monday => (
              <WeekRow key={monday.getTime()} monday={monday} items={items} today={today} month={view === 'month' ? month.getMonth() : null} focused={view === 'month' && monday.getTime() === focus.getTime()}
                onOpen={onOpen} onPickWeek={view === 'month' ? picked => go(picked, month) : undefined} />
            ))}
          </div>
          <div className="jh-wb-cal-legend" aria-hidden="true">{TYPES.map(type => <span key={type} className={`is-${type}`}><i />{TYPE_LABELS[type]}</span>)}<span className="is-open"><i />In progress</span></div>
          <div className="jh-wb-area">
            <span>Week of {current?.range ?? `${ukDate(focus)} to ${ukDate(addDays(focus, 6))}`}</span>
            {!current ? <p className="jh-wb-muted">{note || 'Loading'}</p> : (
              <div className="jh-wb-week-stats">
                <div className="jh-wb-week-total"><strong>{current.total}</strong><span>done</span></div>
                <div className="jh-wb-chips" aria-label="Done by type">
                  {TYPES.map(type => <span key={type} className={`jh-wb-typechip is-${type}${current.byType[type] ? ' is-on' : ''}`}><Icon name={type} />{plural(current.byType[type], TYPE_LABELS[type])}</span>)}
                </div>
                <span className="jh-wb-week-average">{current.average ? <>Average <strong>{current.average}</strong> of active work</> : 'No average yet'}</span>
                <span className="jh-wb-week-average"><strong>{items.filter(item => item.state === 'doing').length}</strong> in progress now</span>
              </div>
            )}
          </div>
          {current && <div className="jh-wb-area">
            <span>Still in flight</span>
            {current.inFlight.length
              ? <ul className="jh-wb-week-list" aria-label="Still in flight">{current.inFlight.map(item => (
                  <li key={item.id}><TypeIcon type={item.type} /><button type="button" className="jh-wb-week-title" onClick={() => onOpen(item.id)}>{item.title}</button><CardTags names={item.tags} tags={tags} />
                    <span className={`jh-wb-task-state is-${item.state}`}>{COLUMN_LABELS[item.state]}</span><span className="jh-wb-week-age">for {item.for}</span></li>
                ))}</ul>
              : <p className="jh-wb-muted">Nothing in flight for over 7 days</p>}
          </div>}
        </div>
        <footer className="jh-wb-sheet-foot">
          <span className="jh-wb-week-note" aria-live="polite">{current ? note : ''}</span>
          <span className="jh-wb-spacer" />
          <button type="button" className="jh-wb-quiet" disabled={!current} onClick={copy}><Icon name="copy" />Copy as Markdown</button>
          <button type="button" className="jh-wb-primary jh-wb-week-save" disabled={!current || busy} onClick={save}><Icon name="save" />Save to knowledge</button>
        </footer>
      </section>
    </div>
  )
}

/* ─── Board picker ─── */

// The menu rows: every board with its item count, the open one with its live title and count.
function menuRows(boards: WorkBoardSummaryRow[], board: WorkBoardData | null): BoardMenuRow[] {
  const count = (row: WorkBoardSummaryRow) => COLUMNS.reduce((sum, column) => sum + (row.counts[column] ?? 0), 0)
  const rows = boards.map(row => row.slug === board?.slug ? { slug: row.slug, title: board.title, count: board.items.length } : { slug: row.slug, title: row.title, count: count(row) })
  return board && !boards.some(row => row.slug === board.slug) ? [{ slug: board.slug, title: board.title, count: board.items.length }, ...rows] : rows
}

/* ─── Board ─── */

// Type and tag filter. No types picked means every type; with tags picked an item needs one of them.
function matcher(types: Set<ItemType>, tags: Set<string>) {
  if (!types.size && !tags.size) return null
  return (item: WorkItem) => (!types.size || types.has(item.type)) && (!tags.size || item.tags.some(tag => tags.has(tag)))
}

/**
 * The full kanban work board, rendered inside a dashboard focus window.
 * `projects` are the Workspace cards; an older board linked to one names it in the chat prompt.
 */
export default function WorkBoard({ projects }: { projects: { id: string; title: string }[] }) {
  const [boards, setBoards] = useState<WorkBoardSummaryRow[]>([])
  const [board, setBoard] = useState<WorkBoardData | null>(null)
  const [error, setError] = useState('')
  const [status, setStatus] = useState<Status>('')
  // True while a change waits for the autosave, so the board menu's Save can save it now.
  const [pending, setPending] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [openTask, setOpenTask] = useState<string | null>(null)
  // The ticket previewed in the side panel (with the task that was clicked, if any); null shows the project overview.
  const [selected, setSelected] = useState<{ id: string; task: string | null } | null>(null)
  const [panelOpen, setPanelOpen] = useState(panelWasOpen)
  const root = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [drag, setDrag] = useState<Drag | null>(null)
  const [naming, setNaming] = useState<string | null>(null)
  const [types, setTypes] = useState<Set<ItemType>>(() => new Set())
  const [tagFilter, setTagFilter] = useState<Set<string>>(() => new Set())
  const [week, setWeek] = useState(false)
  // Moving an item that was in progress before back into In progress asks how to count its time.
  const [resume, setResume] = useState<{ title: string; days: string; run: (mode: ResumeMode) => void } | null>(null)
  const resumeOpen = useRef(false)
  useEffect(() => { resumeOpen.current = resume !== null }, [resume])
  // Backlog: everything, only what needs refining, or only what is ready.
  const [refineFilter, setRefineFilter] = useState<'all' | 'needs' | 'ready'>('all')
  // False until the first list arrives, so "No boards yet" never flashes while loading.
  const [ready, setReady] = useState(false)
  // The board just deleted, offered back by the "Board deleted" toast for UNDO_MS.
  const [undo, setUndo] = useState<{ slug: string; name: string } | null>(null)
  const undoTimer = useRef({ id: 0 })
  const boardRef = useRef<WorkBoardData | null>(null)
  const dirty = useRef(false)
  const timer = useRef<number | undefined>(undefined)
  const chain = useRef<Promise<unknown>>(Promise.resolve())
  const columnsRef = useRef(new Map<Column, HTMLElement>())
  const dragRef = useRef<Drag | null>(null)
  const matchRef = useRef<((item: WorkItem) => boolean) | null>(null)
  const suppressClick = useRef(false)
  const matches = useMemo(() => matcher(types, tagFilter), [types, tagFilter])
  useEffect(() => { matchRef.current = matches }, [matches])

  // Showing another board (switching, creating, restoring) never keeps the previous board's selected ticket.
  const show = useCallback((next: WorkBoardData) => { if (boardRef.current?.id !== next.id) setSelected(null); boardRef.current = next; dirty.current = false; setPending(false); setBoard(next); rememberBoard(next.slug) }, [])
  const refreshList = useCallback(() => listBoards().then(setBoards).catch(() => { /* the list refreshes on the next save */ }), [])

  // Saves the pending change now. Returns that save, which rejects when it fails.
  const flush = useCallback(() => {
    window.clearTimeout(timer.current); timer.current = undefined
    setPending(false)
    const next = boardRef.current
    if (!next || !dirty.current) return undefined
    dirty.current = false
    setStatus('saving')
    const attempt = chain.current.then(() => saveBoard(next))
    chain.current = attempt.then(() => {
      if (!dirty.current) setStatus('saved')
      setError('')
      announceWorkChange()
      refreshList()
    }).catch(reason => { setError(message(reason)); setStatus('') })
    return attempt
  }, [refreshList])
  // Saves any pending change and resolves once every save so far has finished.
  const settle = useCallback(() => { flush(); return chain.current }, [flush])

  const commit = useCallback((change: (current: WorkBoardData) => WorkBoardData, immediate = false) => {
    const current = boardRef.current
    if (!current) return
    const next = change(current)
    if (next === current) return
    boardRef.current = next; dirty.current = true; setBoard(next)
    window.clearTimeout(timer.current)
    if (immediate) flush()
    else { setStatus('saving'); setPending(true); timer.current = window.setTimeout(flush, 400) }
  }, [flush])

  useEffect(() => {
    let live = true
    listBoards()
      .then(rows => { if (!live) return null; setBoards(rows); const pick = preferredBoard(rows); return pick ? loadBoard(pick.slug) : null })
      .then(loaded => { if (!live) return; if (loaded) show(loaded); setReady(true) })
      .catch(reason => { if (live) { setError(message(reason)); setReady(true) } })
    const timers = undoTimer.current
    return () => { live = false; flush(); window.clearTimeout(timers.id) }
  }, [show, flush])

  // Jupiter added or changed an item by voice: show that board with the change.
  useEffect(() => {
    const onReload = (event: Event) => {
      const slug = (event as CustomEvent<{ slug?: string }>).detail?.slug || boardRef.current?.slug
      if (!slug || dirty.current) return
      listBoards().then(rows => { setBoards(rows); return loadBoard(slug) }).then(show).catch(reason => setError(message(reason)))
    }
    window.addEventListener('jupiter-work-reload', onReload)
    return () => window.removeEventListener('jupiter-work-reload', onReload)
  }, [show])

  // Escape closes the detail sheet (or the weekly summary) without also closing the dashboard
  // window. Inside a Markdown editor it only leaves the editor.
  useEffect(() => {
    if (!openId && !week) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || (event.target as Element | null)?.closest?.('.jh-wb-md-edit')) return
      event.stopPropagation()
      if (resumeOpen.current) setResume(null); else if (openId) setOpenId(null); else setWeek(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [openId, week])

  const patchItem = useCallback((id: string, patch: Partial<WorkItem>, immediate = false, mode: ResumeMode = 'continue') => commit(current => {
    const target = current.items.find(item => item.id === id)
    if (!target) return current
    const moved = patch.state && patch.state !== target.state
    const order = moved ? Math.max(-1, ...itemsIn(current, patch.state as Column).map(item => item.order)) + 1 : target.order
    const completed = patch.state ? completedFor(target, patch.state) : target.completed
    const stamp = now()
    const cycle = moved ? moveItem(target, patch.state as Column, stamp, mode) : {}
    return { ...current, items: current.items.map(item => item.id === id ? { ...item, ...patch, ...cycle, order, completed, updated: stamp } : item) }
  }, immediate), [commit])
  // Into In progress again after an earlier spell: ask whether to continue that count or start a new one.
  // The first time, or any other move, goes straight through. Cancel leaves the item where it was.
  const viaResume = (item: WorkItem, state: Column, run: (mode: ResumeMode) => void) => {
    if (state === 'doing' && item.state !== 'doing' && item.cycles.length) setResume({ title: item.title, days: span(tracking(item).activeMs, true), run: mode => { setResume(null); run(mode) } })
    else run('continue')
  }

  // Adds a tag to an item, creating it on the board (with the next palette colour) when it is new.
  const tagItem = (id: string, name: string) => commit(current => {
    const clean = name.replace(/\s+/g, ' ').trim().slice(0, MAX_TAG)
    if (!clean) return current
    const existing = current.tags.find(tag => tag.name.toLowerCase() === clean.toLowerCase())
    if (!existing && current.tags.length >= MAX_BOARD_TAGS) { setError('This board has too many tags.'); return current }
    const tag = existing ?? { name: clean, color: TAG_COLORS[current.tags.length % TAG_COLORS.length] }
    const target = current.items.find(item => item.id === id)
    if (!target || target.tags.includes(tag.name) || target.tags.length >= MAX_ITEM_TAGS) return current
    return { ...current, tags: existing ? current.tags : [...current.tags, tag], items: current.items.map(item => item.id === id ? { ...item, tags: [...item.tags, tag.name], updated: now() } : item) }
  }, true)

  const addItem = (column: Column, title: string, type: ItemType) => commit(current => {
    if (current.items.length >= MAX_ITEMS) { setError('This board is full.'); return current }
    const first = itemsIn(current, column)[0]
    const stamp = now()
    // New items need refining; one added straight into In progress starts its first work cycle.
    const item: WorkItem = { id: newId('w'), type, title, details: '', acceptance: '', state: column, tags: [], priority: 'none', due: null, order: (first?.order ?? 0) - 1, tasks: [], created: stamp, updated: stamp, completed: column === 'done' ? stamp : null,
      refined: false, cycles: column === 'doing' ? [{ start: stamp, end: null, fresh: true }] : [], history: [] }
    return { ...current, items: [item, ...current.items] }
  }, true)

  const setTask = (item: WorkItem, id: string, patch: Partial<WorkTask>) => patchItem(item.id, { tasks: item.tasks.map(task => task.id === id ? { ...task, ...patch } : task) }, true)
  const addTask = (item: WorkItem, title: string) => {
    if (item.tasks.length >= MAX_TASKS) return
    patchItem(item.id, { tasks: [...item.tasks, { id: newId('t'), title, done: false, state: 'todo', details: '', created: now(), completed: null, cycles: [] }] }, true)
  }
  // The side panel: selecting opens it, Back returns to the overview and puts keyboard focus back on the card.
  const select = (id: string, task: string | null = null) => { setSelected({ id, task }); setPanelOpen(true) }
  const togglePanel = () => { const next = !panelOpen; setPanelOpen(next); rememberPanel(next) }
  const back = () => {
    const id = selected?.id
    setSelected(null)
    if (id) window.requestAnimationFrame(() => root.current?.querySelector<HTMLElement>(`[data-card="${CSS.escape(id)}"] .jh-wb-card-title`)?.focus())
  }
  const changeState = (item: WorkItem, state: Column) => viaResume(item, state, mode => patchItem(item.id, { state }, true, mode))
  const toggle = (id: string) => setExpanded(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next })
  const toggleTag = (name: string) => setTagFilter(current => { const next = new Set(current); if (next.has(name)) next.delete(name); else next.add(name); return next })
  const toggleType = (type: ItemType) => setTypes(current => { const next = new Set(current); if (next.has(type)) next.delete(type); else next.add(type); return next })

  const setLimit = (column: LimitedColumn, value: number | null) => commit(current => ({ ...current, limits: { ...(current.limits ?? DEFAULT_LIMITS), [column]: value } }), true)

  const switchBoard = (slug: string) => {
    if (slug === board?.slug) return
    flush(); setOpenId(null); setWeek(false); setTagFilter(new Set())
    loadBoard(slug).then(show).catch(reason => setError(message(reason)))
  }
  const makeBoard = (title: string) => {
    flush(); setNaming(null); setOpenId(null); setWeek(false); setTagFilter(new Set())
    createBoard(title).then(created => { show(created); refreshList(); announceWorkChange() }).catch(reason => setError(message(reason)))
  }
  const dropUndo = () => { window.clearTimeout(undoTimer.current.id); setUndo(null) }
  // Drops any unsaved change to the board, waits for saves in flight, then moves its files to
  // knowledge/work/.deleted and opens the next board, or the empty state when it was the last.
  // A toast offers Undo for a few seconds.
  const removeBoard = () => {
    const current = boardRef.current
    if (!current) return
    window.clearTimeout(timer.current); timer.current = undefined; dirty.current = false
    setPending(false); setOpenId(null); setWeek(false); setTagFilter(new Set()); setStatus('')
    chain.current = chain.current.then(() => deleteBoard(current.slug)).then(result => {
      setBoards(result.boards); setError(''); announceWorkChange()
      window.clearTimeout(undoTimer.current.id)
      setUndo({ slug: current.slug, name: result.name })
      undoTimer.current.id = window.setTimeout(() => setUndo(null), UNDO_MS)
      if (result.next) return loadBoard(result.next).then(show)
      boardRef.current = null; setBoard(null)
    }).catch(reason => setError(message(reason)))
  }
  // Undo: puts the deleted board back from .deleted and opens it.
  const restore = () => {
    const last = undo
    if (!last) return
    dropUndo(); flush(); setOpenId(null); setWeek(false); setTagFilter(new Set())
    chain.current = chain.current.then(() => restoreBoard(last.slug, last.name)).then(restored => {
      show(restored); setError(''); refreshList(); announceWorkChange()
    }).catch(reason => setError(message(reason)))
  }

  const visibleIn = (data: WorkBoardData, column: Column, filter: ((item: WorkItem) => boolean) | null) => filter ? itemsIn(data, column).filter(filter) : itemsIn(data, column)

  // Where the pointer would drop the card: the column under it, the index among its visible cards
  // and the card it would go in front of.
  const locate = (x: number, y: number, id: string) => {
    for (const [column, element] of columnsRef.current) {
      const rect = element.getBoundingClientRect()
      if (x < rect.left || x > rect.right) continue
      const cards = [...element.querySelectorAll<HTMLElement>('[data-card]')].filter(card => card.dataset.card !== id)
      let index = cards.length
      for (let n = 0; n < cards.length; n++) { const box = cards[n].getBoundingClientRect(); if (y < box.top + box.height / 2) { index = n; break } }
      return { column, index, before: cards[index]?.dataset.card ?? null }
    }
    return null
  }
  const drop = (moving: Drag, mode: ResumeMode = 'continue') => commit(current => {
    const item = current.items.find(other => other.id === moving.id)
    if (!item) return current
    const list = itemsIn(current, moving.column).filter(other => other.id !== moving.id)
    const at = moving.before ? list.findIndex(other => other.id === moving.before) : -1
    list.splice(at < 0 ? list.length : at, 0, item)
    const place = new Map(list.map((other, order) => [other.id, order]))
    const changed = item.state !== moving.column || list.some(other => current.items.find(old => old.id === other.id)?.order !== place.get(other.id))
    if (!changed) return current
    return { ...current, items: current.items.map(other => place.has(other.id) ? { ...other, state: moving.column, order: place.get(other.id) as number, ...(other.id === item.id && item.state !== moving.column ? { ...moveItem(item, moving.column, now(), mode), updated: now(), completed: completedFor(item, moving.column) } : {}) } : other) }
  }, true)

  const startDrag = (event: ReactPointerEvent<HTMLElement>, item: WorkItem) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('input, textarea, select, label, .jh-wb-expand, .jh-wb-add, .jh-wb-addline, .jh-wb-card-tasks')) return
    const card = event.currentTarget
    const start = { x: event.clientX, y: event.clientY }
    let started = false
    const move = (pointer: PointerEvent) => {
      if (!started) {
        if (Math.hypot(pointer.clientX - start.x, pointer.clientY - start.y) < 5) return
        started = true
        const rect = card.getBoundingClientRect()
        const visible = boardRef.current ? visibleIn(boardRef.current, item.state, matchRef.current) : []
        const index = Math.max(0, visible.findIndex(other => other.id === item.id))
        dragRef.current = { id: item.id, dx: start.x - rect.left, dy: start.y - rect.top, width: rect.width, height: rect.height, x: pointer.clientX, y: pointer.clientY, column: item.state, index, before: visible[index + 1]?.id ?? null }
      }
      pointer.preventDefault()
      const current = dragRef.current
      if (!current) return
      const next = { ...current, x: pointer.clientX, y: pointer.clientY, ...locate(pointer.clientX, pointer.clientY, item.id) }
      dragRef.current = next; setDrag(next)
    }
    const end = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end)
      const finished = dragRef.current
      dragRef.current = null
      if (!started || !finished) return
      suppressClick.current = true
      window.setTimeout(() => { suppressClick.current = false }, 0)
      setDrag(null)
      const target = boardRef.current?.items.find(other => other.id === finished.id)
      if (target) viaResume(target, finished.column, mode => drop(finished, mode)); else drop(finished)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }

  const open = board?.items.find(item => item.id === openId)
  const inspected = board?.items.find(item => item.id === selected?.id)
  const dragged = drag && board?.items.find(item => item.id === drag.id)
  const filtering = matches !== null
  const boardTags = board?.tags ?? []
  const usedTags = boardTags.filter(tag => tagFilter.has(tag.name) || board?.items.some(item => item.tags.includes(tag.name)))

  return (
    <div ref={root} className={`jh-wb jh-wb-board${drag ? ' is-dragging' : ''}`}>
      <header className="jh-wb-bar">
        <div className="jh-wb-bar-board">
          {naming !== null
            ? <div className="jh-wb-naming">
                <input className="jh-wb-input" autoFocus value={naming} maxLength={500} placeholder="New board title" aria-label="New board title" onChange={event => setNaming(event.target.value)}
                  onKeyDown={event => { keepEscape(event); if (event.key === 'Enter' && naming.trim()) makeBoard(naming.trim()); if (event.key === 'Escape') setNaming(null) }} />
                <button type="button" className="jh-wb-primary" disabled={!naming.trim()} onClick={() => makeBoard(naming.trim())}>Create</button>
                <button type="button" className="jh-wb-quiet" onClick={() => setNaming(null)}>Cancel</button>
              </div>
            : ready && <BoardMenu rows={menuRows(boards, board)} current={board?.slug ?? null} title={board?.title ?? null} onPick={switchBoard} onNew={() => setNaming('')}
                onSave={() => flush() ?? chain.current} unsaved={pending} onDelete={board ? removeBoard : undefined} />}
          {board && <TitleInput key={board.id} className="jh-wb-title" label="Board title" value={board.title} onCommit={title => commit(current => ({ ...current, title }))} />}
        </div>
        <div className="jh-wb-bar-tools">
          {board && <div className="jh-wb-filter">
            <div className="jh-wb-chips" role="group" aria-label="Filter by type">
              {TYPES.map(type => (
                <button key={type} type="button" className={`jh-wb-typechip is-${type}${types.has(type) ? ' is-on' : ''}`} aria-pressed={types.has(type)} onClick={() => toggleType(type)}>
                  <Icon name={type} />{TYPE_LABELS[type]}
                </button>
              ))}
            </div>
            {usedTags.length > 0 && <div className="jh-wb-chips" role="group" aria-label="Filter by tag">
              {usedTags.map(tag => (
                <button key={tag.name} type="button" className={`jh-wb-tagchip is-${tag.color}${tagFilter.has(tag.name) ? ' is-on' : ''}`} aria-pressed={tagFilter.has(tag.name)} onClick={() => toggleTag(tag.name)}>{tag.name}</button>
              ))}
            </div>}
          </div>}
          {error &&<span className="jh-wb-error" role="alert">{error}</span>}
          {board && <button type="button" className="jh-wb-quiet jh-wb-week-open" onClick={() => { setOpenId(null); setWeek(true) }}><Icon name="week" />This week</button>}
          {!open && <span className="jh-wb-status" aria-live="polite">{status === 'saving' ? 'Saving' : status === 'saved' ? 'Saved' : ''}</span>}
        </div>
      </header>

      {ready && !board ? (
        <div className="jh-wb-empty">
          <span className="jh-wb-empty-icon"><Icon name="week" /></span>
          <h3>No boards yet</h3>
          <p className="jh-wb-muted">A board keeps your features, bugs and spikes in three columns: Backlog, In progress and Done.</p>
          <button type="button" className="jh-wb-primary jh-wb-empty-create" onClick={() => setNaming('')}><Icon name="plus" />Create a board</button>
        </div>
      ) : <div className="jh-wb-work">
        <div className="jh-wb-columns">
        {COLUMNS.map(column => {
          const shown = board ? visibleIn(board, column, matches).filter(item => column !== 'todo' || refineFilter === 'all' || item.refined === (refineFilter === 'ready')) : []
          const items = shown.filter(item => item.id !== drag?.id)
          const placeholder = drag?.column === column ? Math.min(drag.index, items.length) : -1
          const total = board ? board.items.filter(item => item.state === column).length : 0
          const limit = isLimited(column) ? (board?.limits ?? DEFAULT_LIMITS)[column] : null
          const over = limit !== null && total > limit
          return (
            <section key={column} className={`jh-wb-col is-${column}${drag?.column === column ? ' is-target' : ''}${over ? ' is-over' : ''}`} aria-label={COLUMN_LABELS[column]}
              ref={element => { if (element) columnsRef.current.set(column, element); else columnsRef.current.delete(column) }}>
              <header className="jh-wb-col-head"><h3>{COLUMN_LABELS[column]}</h3>
                <ColumnCount key={board?.id} column={column} shown={shown.length} total={total} limit={limit} onLimit={value => { if (isLimited(column)) setLimit(column, value) }} />
              </header>
              {column === 'todo' && board && <div className="jh-wb-refine-filter" role="group" aria-label="Show in Backlog">
                {([['all', 'All'], ['needs', 'Needs refinement'], ['ready', 'Ready']] as const).map(([value, label]) => <button key={value} type="button" title={label} aria-pressed={refineFilter === value} onClick={() => setRefineFilter(value)}>{label}</button>)}
              </div>}
              {over && <p className="jh-wb-over">Over the limit</p>}
              {board && <AddItem onAdd={(title, type) => addItem(column, title, type)} />}
              <div className="jh-wb-list">
                {items.map((item, index) => (
                  <div key={item.id} className="jh-wb-slot">
                    {placeholder === index && <div className="jh-wb-placeholder" style={{ height: drag?.height }} />}
                    <Card item={item} tags={boardTags} expanded={expanded.has(item.id)} selected={inspected?.id === item.id}
                      onToggle={() => toggle(item.id)} onOpen={task => { if (!suppressClick.current) select(item.id, task ?? null) }}
                      onTask={(id, patch) => setTask(item, id, patch)} onAddTask={title => addTask(item, title)} onPointerDown={event => startDrag(event, item)} />
                  </div>
                ))}
                {placeholder === items.length && <div className="jh-wb-placeholder" style={{ height: drag?.height }} />}
                {filtering && !items.length && placeholder < 0 && <p className="jh-wb-muted jh-wb-nomatch">No matches</p>}
              </div>
            </section>
          )
        })}
        </div>
        {board && <SidePanel items={board.items} tags={boardTags} item={inspected} focusTask={inspected ? selected?.task ?? null : null} open={panelOpen}
          onToggle={togglePanel} onSelect={id => select(id)} onBack={back}
          onState={changeState} onRefined={item => patchItem(item.id, { refined: true }, true)} onAcceptance={(item, acceptance) => patchItem(item.id, { acceptance }, true)} onTask={setTask}
          onEdit={() => { if (inspected) { setOpenTask(selected?.task ?? null); setOpenId(inspected.id) } }} />}
      </div>}

      {week && board && <CalendarSheet key={board.slug} slug={board.slug} items={board.items} tags={boardTags} settle={settle} onOpen={id => { setOpenTask(null); setOpenId(id) }} onClose={() => setWeek(false)} />}

      {open && <Detail key={open.id} item={open} tags={boardTags} status={status} initialTask={openTask} board={{ title: board?.title || '', slug: board?.slug || '', project: projects.find(project => project.id === board?.project)?.title || null }} onTag={name => tagItem(open.id, name)}
        onPatch={(patch, immediate) => {
          const soon = immediate ?? (['state', 'type', 'tags', 'tasks', 'priority', 'due', 'refined'] as (keyof WorkItem)[]).some(key => patch[key] !== undefined)
          if (patch.state) viaResume(open, patch.state, mode => patchItem(open.id, patch, true, mode)); else patchItem(open.id, patch, soon)
        }}
        onDelete={() => { setOpenId(null); commit(current => ({ ...current, items: current.items.filter(item => item.id !== open.id) }), true) }}
        onClose={() => setOpenId(null)} />}

      {resume && <div className="jh-wb-sheet-wrap jh-wb-resume-wrap" onPointerDown={event => { if (event.target === event.currentTarget) setResume(null) }}>
        <section className="jh-wb-resume" role="alertdialog" aria-modal="true" aria-labelledby="jh-wb-resume-title">
          <h3 id="jh-wb-resume-title">Resume work on this ticket?</h3>
          <p>This ticket was previously in progress for {resume.days}. How would you like to track it?</p>
          <div className="jh-wb-resume-options">
            <button type="button" className="jh-wb-primary" autoFocus onClick={() => resume.run('continue')}><b>Continue previous tracking</b><small>Adds this spell to the {resume.days} already counted. Time in Backlog is not counted.</small></button>
            <button type="button" className="jh-wb-quiet" onClick={() => resume.run('new')}><b>Start a new work cycle</b><small>Counts from today. Earlier cycles stay in its history.</small></button>
          </div>
          <footer><button type="button" className="jh-wb-quiet" onClick={() => setResume(null)}>Cancel</button></footer>
        </section>
      </div>}

      {undo && (
        <div className="jh-wb-toast" role="status">
          <Icon name="trash" /><span>Board deleted</span>
          <button type="button" className="jh-wb-toast-undo" onClick={restore}>Undo</button>
          <button type="button" className="jh-wb-icon" onClick={dropUndo} aria-label="Dismiss"><Icon name="close" /></button>
        </div>
      )}

      {drag && dragged && createPortal(
        <div className="jh-wb jh-wb-layer" aria-hidden="true">
          <div className="jh-wb-lift" style={{ left: drag.x - drag.dx, top: drag.y - drag.dy, width: drag.width }}>
            <Card item={dragged} tags={boardTags} expanded={expanded.has(dragged.id)} ghost />
          </div>
        </div>, document.body)}
    </div>
  )
}

/**
 * Compact board summary for the home dashboard's To do panel (fits a ~220px glass panel).
 * Shows the current board (the one last opened here, else the latest updated), its count per
 * column and up to 4 titles from In progress then Backlog. It refreshes itself whenever the full
 * board saves; pass a changing `refreshKey` to force a reload (for example after Ask adds an item).
 */
export function WorkBoardSummary({ refreshKey }: { refreshKey?: unknown }) {
  const [board, setBoard] = useState<WorkBoardData | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  useEffect(() => {
    let live = true
    const load = () => listBoards()
      .then(rows => { const pick = preferredBoard(rows); return pick ? loadBoard(pick.slug) : null })
      .then(loaded => { if (live) { setBoard(loaded); setState('ready') } })
      .catch(() => { if (live) setState('failed') })
    load()
    window.addEventListener(WORK_CHANGED, load)
    return () => { live = false; window.removeEventListener(WORK_CHANGED, load) }
  }, [refreshKey])
  if (!board) return <div className="jh-wb jh-wb-summary"><p className="jh-wb-muted">{state === 'failed' ? 'Board unavailable' : state === 'ready' ? 'No boards yet' : '…'}</p></div>
  const top = [...itemsIn(board, 'doing'), ...itemsIn(board, 'todo')].slice(0, 4)
  return (
    <div className="jh-wb jh-wb-summary">
      <p className="jh-wb-summary-title">{board.title}</p>
      <dl className="jh-wb-summary-counts">
        {COLUMNS.map(column => <div key={column} className={`is-${column}`}><dt>{COLUMN_LABELS[column]}</dt><dd>{board.items.filter(item => item.state === column).length}</dd></div>)}
      </dl>
      {top.length
        ? <ul className="jh-wb-summary-items">{top.map(item => <li key={item.id} className={`is-${item.state}`}><TypeIcon type={item.type} /><span>{item.title}</span></li>)}</ul>
        : <p className="jh-wb-muted">Nothing to do</p>}
    </div>
  )
}
