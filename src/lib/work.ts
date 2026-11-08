import { api } from '../desktop/client'

// Backlog is stored as 'todo'. Testing was retired; old history entries may still name it.
export type Column = 'todo' | 'doing' | 'done'
export type ItemType = 'feature' | 'bug' | 'spike'
export type Priority = 'none' | 'low' | 'medium' | 'high'
export const COLUMNS: Column[] = ['todo', 'doing', 'done']
export const COLUMN_LABELS: Record<Column, string> = { todo: 'Backlog', doing: 'In progress', done: 'Done' }
export const TYPES: ItemType[] = ['feature', 'bug', 'spike']
export const TYPE_LABELS: Record<ItemType, string> = { feature: 'Feature', bug: 'Bug', spike: 'Spike' }
export const PRIORITIES: Priority[] = ['none', 'low', 'medium', 'high']
export const PRIORITY_LABELS: Record<Priority, string> = { none: 'No priority', low: 'Low', medium: 'Medium', high: 'High' }

/** A child task. `done` always equals `state === 'done'`; `completed` is set while it is Done. `cycles` is when it was In progress: a task that never started has none. */
export interface WorkTask { id: string; title: string; done: boolean; state: Column; details: string; created: string; completed: string | null; cycles: WorkCycle[] }
export const TAG_COLORS = ['ice', 'violet', 'green', 'amber', 'pink', 'teal', 'lime', 'orange'] as const
export type TagColor = typeof TAG_COLORS[number]
export interface WorkTag { name: string; color: TagColor }
export interface WorkItem {
  id: string; type: ItemType; title: string; details: string; acceptance: string; state: Column
  /** Tag names from the board's tag list. */ tags: string[]; priority: Priority; /** YYYY-MM-DD or null */ due: string | null; order: number; tasks: WorkTask[]
  created: string; updated: string; /** When it reached Done; null while not Done. */ completed: string | null
  /** Ready to start (Refined) or still Needs refinement. Its own property, never a tag. */ refined: boolean
  /** Each stretch In progress. */ cycles: WorkCycle[]; /** State changes, oldest first. */ history: WorkMove[]
}
/** One stretch In progress; end is null while it runs. fresh: it started a new count rather than continuing. legacy: taken from a board saved before cycles. */
export interface WorkCycle { start: string; end: string | null; fresh?: boolean; legacy?: boolean }
export interface WorkMove { at: string; from: Column | 'testing'; to: Column }
/** Optional work in progress limits, 1 to 50; null means no limit. */
export type LimitedColumn = 'doing'
export const LIMITED: LimitedColumn[] = ['doing']
export type WorkLimits = Record<LimitedColumn, number | null>
export const LIMIT_RANGE = { min: 1, max: 50 }
export interface WorkBoardData { id: string; slug: string; title: string; project: string | null; columns: Column[]; limits: WorkLimits; tags: WorkTag[]; items: WorkItem[]; created: string; updated: string }
export interface WorkBoardSummaryRow { slug: string; title: string; project: string | null; counts: Record<Column, number>; updated: string }

/** The weekly Done summary, computed by the service so the sheet and the saved file match. */
export interface WeeklyDone { id: string; type: ItemType; title: string; tags: string[]; created: string; completed: string; ms: number; after: string }
export interface WeeklyFlight { id: string; type: ItemType; title: string; tags: string[]; state: 'doing'; created: string; ms: number; for: string }
export interface WeeklySummary {
  slug: string; title: string; offsetWeeks: number; start: string; end: string; date: string; range: string
  total: number; byType: Record<ItemType, number>; averageMs: number | null; average: string | null; done: WeeklyDone[]; inFlight: WeeklyFlight[]; markdown: string
}

export const listBoards = () => api<WorkBoardSummaryRow[]>('/work/boards')
export const loadBoard = (slug: string) => api<WorkBoardData>(`/work/boards/${encodeURIComponent(slug)}`)
export const createBoard = (title: string, project: string | null = null) => api<WorkBoardData>('/work/boards', { title, project })
export const saveBoard = (board: WorkBoardData) => api<WorkBoardData>(`/work/boards/${encodeURIComponent(board.slug)}`, { board }, 'PUT')
/** Moves the board's files to knowledge/work/.deleted; `next` is the board to show now (null when none remain) and `name` is what restoreBoard takes. */
export const deleteBoard = (slug: string) => api<{ deleted: string; name: string; moved: string[]; boards: WorkBoardSummaryRow[]; next: string | null }>(`/work/boards/${encodeURIComponent(slug)}`, undefined, 'DELETE')
/** Puts a deleted board back from knowledge/work/.deleted (its slug may change if it was taken meanwhile). */
export const restoreBoard = (slug: string, name: string) => api<WorkBoardData>(`/work/boards/${encodeURIComponent(slug)}/restore`, { name })
/** The summary for a UK calendar week (Monday to Sunday): 0 is this week, 1 the week before, negative a later week. */
export const loadWeekly = (slug: string, offsetWeeks: number) => api<WeeklySummary>(`/work/boards/${encodeURIComponent(slug)}/weekly?offsetWeeks=${offsetWeeks}`)
export const saveWeekly = (slug: string, offsetWeeks: number) => api<{ path: string }>(`/work/boards/${encodeURIComponent(slug)}/weekly`, { offsetWeeks })
/** Adds a feature to the To do column of the most recently updated board (used by Ask "add X"). */
export const quickAdd = (title: string) => api<WorkBoardData>('/work/quick', { title })

// UK dates everywhere on the board: 02/11/2026.
const UK_DATE = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
export const ukDate = (value: string | Date) => UK_DATE.format(typeof value === 'string' ? new Date(value) : value)
/** "2026-11-04" as 04/11/2026 (a calendar day, no time zone shift). */
export const ukDay = (day: string) => { const [year, month, date] = day.split('-').map(Number); return ukDate(new Date(year, month - 1, date)) }
/** Reads DD/MM/YYYY (or D/M/YYYY, dots or spaces allowed, or YYYY-MM-DD) as YYYY-MM-DD; null when it is not a real date. */
export function parseUkDay(text: string): string | null {
  const value = text.trim()
  const uk = /^(\d{1,2})[/. ](\d{1,2})[/. ](\d{4})$/.exec(value), iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  const [year, month, date] = uk ? [Number(uk[3]), Number(uk[2]), Number(uk[1])] : iso ? [Number(iso[1]), Number(iso[2]), Number(iso[3])] : [0, 0, 0]
  const check = new Date(year, month - 1, date)
  if (!year || check.getFullYear() !== year || check.getMonth() !== month - 1 || check.getDate() !== date) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(date).padStart(2, '0')}`
}

export const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
export const itemsIn = (board: WorkBoardData, column: Column) => board.items.filter(item => item.state === column).sort((a, b) => a.order - b.order)

// The board last opened on this device, remembered for the summary panel.
const KEY = 'jupiter.work.board'
export function rememberBoard(slug: string) { try { localStorage.setItem(KEY, slug) } catch { /* storage may be blocked */ } }
export function preferredBoard(boards: WorkBoardSummaryRow[]): WorkBoardSummaryRow | undefined {
  let saved = ''
  try { saved = localStorage.getItem(KEY) || '' } catch { /* storage may be blocked */ }
  return boards.find(board => board.slug === saved) || boards[0]
}

// Lets the summary panel refresh after the full board saves.
export const WORK_CHANGED = 'jupiter-work-changed'
export const announceWorkChange = () => window.dispatchEvent(new Event(WORK_CHANGED))

// --- Work cycles (the same rules as desktop/service/work-items.mjs) ---
// Durations run from the moment of each move; a day is 24 hours. Backlog time is never active.

/** How a move into In progress is counted when the item has been In progress before. */
export type ResumeMode = 'continue' | 'new'
/**
 * The fields that change when an item moves to `state`: leaving In progress ends its cycle, entering
 * starts one (continuing the count, or a new count with mode 'new'), and the move joins its history.
 */
export function moveItem(item: WorkItem, state: Column, at: string, mode: ResumeMode = 'continue'): Pick<WorkItem, 'state' | 'cycles' | 'history'> {
  if (state === item.state) return { state, cycles: item.cycles, history: item.history }
  return { state, cycles: shiftCycles(item.cycles, state, at, mode), history: [...item.history, { at, from: item.state, to: state }].slice(-200) }
}
function shiftCycles(cycles: WorkCycle[], state: Column, at: string, mode: ResumeMode): WorkCycle[] {
  const ended = cycles.map(cycle => cycle.end === null ? { ...cycle, end: at } : cycle)
  return state === 'doing' ? [...ended, { start: at, end: null, ...(mode === 'new' || !ended.length ? { fresh: true } : {}) }] : ended
}
/**
 * The fields that change when a task moves to `state` (its checkbox, or its own state): done follows
 * the state, and the same cycle rules apply, so its time starts when it first enters In progress.
 */
export function moveTask(task: WorkTask, state: Column, at: string): Pick<WorkTask, 'state' | 'done' | 'completed' | 'cycles'> {
  if (state === task.state) return { state, done: task.done, completed: task.completed, cycles: task.cycles }
  return { state, done: state === 'done', completed: state === 'done' ? at : null, cycles: shiftCycles(task.cycles, state, at, 'continue') }
}
export interface Tracking { cycles: number; currentMs: number; inFlightMs: number; activeMs: number; elapsedMs: number; started: string | null }
/** currentMs: the latest cycle. inFlightMs: from the latest fresh cycle on. activeMs: all cycles. elapsedMs: first start to Done or now, pauses included. */
export function tracking(item: Pick<WorkItem, 'state' | 'cycles'>, now = Date.now()): Tracking {
  const cycles = item.cycles || []
  if (!cycles.length) return { cycles: 0, currentMs: 0, inFlightMs: 0, activeMs: 0, elapsedMs: 0, started: null }
  const length = (cycle: WorkCycle) => Math.max(0, (cycle.end ? Date.parse(cycle.end) : now) - Date.parse(cycle.start))
  let from = cycles.length - 1
  while (from > 0 && !cycles[from].fresh) from--
  const sum = (list: WorkCycle[]) => list.reduce((total, cycle) => total + length(cycle), 0)
  const last = cycles[cycles.length - 1]
  const finish = item.state === 'done' && last.end ? Date.parse(last.end) : now
  return { cycles: cycles.length, currentMs: length(last), inFlightMs: sum(cycles.slice(from)), activeMs: sum(cycles), elapsedMs: Math.max(0, finish - Date.parse(cycles[0].start)), started: cycles[0].start }
}
