export type CoreState = 'idle' | 'ambient' | 'listening' | 'thinking' | 'speaking' | 'reading'
export type CorePalette = 'rainbow' | 'ice'

export interface CoreOptions {
  palette?: CorePalette
  /** Orb radius as a fraction of the smaller canvas side. */
  radius?: number
  /** Orb centre as fractions of the canvas width and height. */
  cx?: number
  cy?: number
  /** Overall brightness, 0–1. */
  dim?: number
  idleFps?: number
  seed?: number
  /** State the orb returns to after speaking. */
  base?: CoreState
  shell?: number
  interior?: number
  stars?: number
  hubs?: number
}

export interface CoreController {
  readonly state: CoreState
  readonly palette: CorePalette
  setState(state: CoreState): void
  setPalette(palette: CorePalette): void
  /** Fire the central hub once (for confirmations). */
  pulse(strength?: number): void
  /** Pointer position from -1 to 1 for the parallax tilt. */
  setPointer(x: number, y: number): void
  /** The loudness of Jupiter's voice right now, 0 to 1; the star pulses with it. */
  setVoice(level: number): void
  /** Without audio levels: a gentle beat per word while the text would be spoken. Resolves when done. */
  say(text: string, options?: { onWord?: (index: number) => void }): Promise<void>
  destroy(): void
}

export function createCore(canvas: HTMLCanvasElement, options?: CoreOptions): CoreController
