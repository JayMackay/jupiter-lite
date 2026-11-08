import { api } from '../desktop/client'

// Kept for the old single brainstorm layout read by jupiter-home.
export type Point = { x: number; y: number }
export type Board = { positions: Record<string, Point>; links: [string, string][]; strokes: [number, number][][] }
export const EMPTY_BOARD: Board = { positions: {}, links: [], strokes: [] }

// Whiteboards saved in knowledge/boards.
export type ItemType = 'note' | 'shape' | 'image' | 'link'
export type ShapeKind = 'rect' | 'ellipse' | 'diamond' | 'triangle'
// Fill colours for notes and shapes (the bucket). The colours are CSS tokens in whiteboard.css
// (--bd-<name>); deep fills take light text, pastels dark text. 'none' keeps a shape's outline look.
export type Fill = 'navy' | 'teal' | 'indigo' | 'umber' | 'ice' | 'mint' | 'butter' | 'coral' | 'lilac' | 'none'
export const FILLS: { id: Exclude<Fill, 'none'>; label: string }[] = [
  { id: 'navy', label: 'Navy' }, { id: 'teal', label: 'Teal' }, { id: 'indigo', label: 'Indigo' }, { id: 'umber', label: 'Umber' },
  { id: 'ice', label: 'Ice' }, { id: 'mint', label: 'Mint' }, { id: 'butter', label: 'Butter' }, { id: 'coral', label: 'Coral' }, { id: 'lilac', label: 'Lilac' },
]
// Notes saved before fills existed keep the colour of their tone.
const TONE_FILL: Fill[] = ['navy', 'teal', 'umber', 'indigo']
export const fillOf = (item: { type: ItemType; fill?: Fill; tone?: number }): Fill => item.fill || (item.type === 'note' ? TONE_FILL[item.tone || 0] || 'navy' : 'none')
export type Item = { id: string; type: ItemType; x: number; y: number; w: number; h: number; text?: string; tone?: number; shape?: ShapeKind; color?: string; src?: string; name?: string; url?: string; fill?: Fill; sized?: boolean }
export type Link = { id: string; from: string; to: string }
// A highlight drawn over a card belongs to it (`on`), with points relative to the card, so it moves with the card.
export type Stroke = { id: string; kind: 'pen' | 'highlight'; color: string; size: number; points: [number, number][]; on?: string }
export type Doc = { title: string; items: Item[]; links: Link[]; strokes: Stroke[] }
export type SavedBoard = Doc & { slug: string }
export type BoardInfo = { slug: string; title: string; updated: string | null; count: number; preview: string[] }

export const listBoards = () => api<BoardInfo[]>('/boards')
export const readBoard = (slug: string) => api<SavedBoard>(`/boards/${encodeURIComponent(slug)}`)
export const saveBoard = (slug: string | null, doc: Doc) => slug ? api<SavedBoard>(`/boards/${encodeURIComponent(slug)}`, doc, 'PUT') : api<SavedBoard>('/boards', doc)
export const deleteBoard = (slug: string) => api<{ deleted: string }>(`/boards/${encodeURIComponent(slug)}`, {}, 'DELETE')
export const quickIdea = (text: string) => api<SavedBoard>('/boards/quick', { text })
export const newId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 12)
