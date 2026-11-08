export type TicketType = 'feature' | 'bug' | 'spike'
export type TicketDraftAgent = 'codex' | 'claude' | 'none'
export interface TicketRequest {
  type: TicketType
  title: string
  description: string
  request: string
  board: string | null
  draft: TicketDraftAgent
  explicit: boolean
}
export function parseTicketRequest(text: unknown): TicketRequest | null
export function titleKey(value: unknown): string
export function resolveBoard<T extends { slug: string; title: string }>(boards: T[], name: unknown): T | null
export function draftSeed(description: string): string
export function agentName(agent: string): string
export function boardPlace(title: unknown): string
export function isPlaceholder(details: unknown): boolean
export function draftBrief(options: { board: { title: string; slug: string }; item: { id: string; title: string; type: string }; request?: string; agent: string }): string
export function checkDraft(options: { board: { title?: string; items: { id: string; title: string; details?: string; acceptance?: string }[] }; id: string; seed?: string; title?: string; agent?: string }): { ok: boolean; text: string }
