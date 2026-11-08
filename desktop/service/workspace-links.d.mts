export const PREVIEW_PORTS: readonly number[]
export type CardLink =
  | { kind: 'card'; id: string; step: number; title: string; note?: string }
  | { kind: 'home' }
  | { kind: 'unknown'; id: string }
  | { kind: 'other' }
export function mayBeCardLink(href: string, appOrigin?: string): boolean
export function cardLink(href: string, options?: { appOrigin?: string; entities?: { id: string; title?: string; steps?: unknown[] }[] }): CardLink
export const unknownCardMessage: (id: string) => string
