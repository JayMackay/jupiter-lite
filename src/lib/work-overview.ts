// The figures behind the work board's Project Overview panel. Pure functions of the board's items, so
// they always reflect the latest ticket changes. No analytics: counts and short ordered lists only.
import type { Priority, WorkItem } from './work'

type Ticket = Pick<WorkItem, 'id' | 'state' | 'priority' | 'due' | 'refined' | 'order'>
const RANK: Record<Priority, number> = { high: 3, medium: 2, low: 1, none: 0 }

/** Highest priority first, then the earliest due date (no date last), then the board's own order. */
const byPriorityThenDue = (a: Ticket, b: Ticket) =>
  RANK[b.priority] - RANK[a.priority] || (a.due ?? '9999-99-99').localeCompare(b.due ?? '9999-99-99') || a.order - b.order

export interface Health { total: number; done: number; percent: number; doing: number; backlog: number; needsRefinement: number }
/** Completed of total, the share done, In progress, Backlog and the Backlog tickets that still need refining. */
export function projectHealth(items: Ticket[]): Health {
  const count = (state: WorkItem['state']) => items.filter(item => item.state === state).length
  const done = count('done'), backlog = items.filter(item => item.state === 'todo')
  return { total: items.length, done, percent: items.length ? Math.round(done / items.length * 100) : 0, doing: count('doing'), backlog: backlog.length, needsRefinement: backlog.filter(item => !item.refined).length }
}

/** Ready (refined) Backlog tickets, the ones to pick up next. */
export const nextUp = <T extends Ticket>(items: T[]): T[] => items.filter(item => item.state === 'todo' && item.refined).sort(byPriorityThenDue)
/** Backlog tickets that still need refining, most important first. */
export const refinementQueue = <T extends Ticket>(items: T[]): T[] => items.filter(item => item.state === 'todo' && !item.refined).sort(byPriorityThenDue)

export interface Deadline<T extends Ticket> { item: T; /** Whole calendar days from today; negative once past. */ days: number; overdue: boolean }
/** Unfinished tickets with a due date, earliest first. Finished tickets never show, and an unfinished one past its date is overdue. */
export function dueSoon<T extends Ticket>(items: T[], today = new Date()): Deadline<T>[] {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  return items.filter(item => item.state !== 'done' && item.due)
    .map(item => {
      const [year, month, day] = (item.due as string).split('-').map(Number)
      const days = Math.round((new Date(year, month - 1, day).getTime() - start.getTime()) / 86400000)
      return { item, days, overdue: days < 0 }
    })
    .sort((a, b) => (a.item.due as string).localeCompare(b.item.due as string) || byPriorityThenDue(a.item, b.item))
}
