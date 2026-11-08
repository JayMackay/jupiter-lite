// The Dashboard greeting: a short line for the local time of day, said to the configured owner.
// Nothing else about the person is used. The wording is chosen once per visit (see Dashboard) and
// never repeats the last visit's line, so opening Jupiter feels fresh without anything flickering.
export type DayPart = 'morning' | 'afternoon' | 'evening' | 'night'
export interface Greeting { id: string; text: string }

// No hyphens or dashes: that is the style for all on screen copy. A trailing "?" stays at the end.
export const PHRASES: Record<DayPart, string[]> = {
  morning: ['Good morning', 'Morning', 'Rise and shine', 'Welcome back', 'Fresh day ahead', 'Ready when you are', 'Good to see you'],
  afternoon: ['Good afternoon', 'Afternoon', 'Welcome back', 'Good to see you', 'Ready when you are', 'Hello again'],
  evening: ['Good evening', 'Evening', 'Welcome back', 'Good to see you', 'Ready when you are', 'Hello again'],
  night: ['Late night', 'Still up?', 'Quiet hours', 'Welcome back', 'Hello again', 'Ready when you are'],
}

export const dayPart = (date: Date): DayPart => {
  const hour = date.getHours()
  return hour >= 5 && hour < 12 ? 'morning' : hour >= 12 && hour < 18 ? 'afternoon' : hour >= 18 && hour < 22 ? 'evening' : 'night'
}

const compose = (text: string, name: string) => {
  const mark = text.endsWith('?') ? '?' : ''
  const lead = mark ? text.slice(0, -1) : text
  return name ? `${lead}, ${name}${mark}` : `${lead}${mark}`
}

/** The same part, name, seed and last line always give the same words. `seed` is in [0, 1). */
export function pickGreeting(part: DayPart, name: string, seed: number, last = ''): Greeting {
  const options = PHRASES[part].filter(text => text !== last)
  const unit = Number.isFinite(seed) ? Math.min(Math.max(seed, 0), 0.999999) : 0
  const id = options[Math.floor(unit * options.length)]
  return { id, text: compose(id, name.trim()) }
}

// The last line shown, kept across visits and launches (this browser or app only).
const KEY = 'jupiter.greeting.last'
let remembered = ''
export const lastGreeting = (): string => { try { return localStorage.getItem(KEY) || remembered } catch { return remembered } }
export const rememberGreeting = (id: string) => { remembered = id; try { localStorage.setItem(KEY, id) } catch { /* optional */ } }
