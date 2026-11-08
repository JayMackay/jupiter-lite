import { useEffect, useRef } from 'react'
import { createCore, type CoreController, type CoreOptions } from '../lib/neural-core.mjs'

interface NeuralCoreProps extends CoreOptions {
  className?: string
  /** Receives the controller once the canvas is ready, and null when it unmounts. */
  onReady?: (core: CoreController | null) => void
}

/** Jupiter's animated orb. Purely decorative, so it is hidden from assistive technology. */
export default function NeuralCore({ className, onReady, ...options }: NeuralCoreProps) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const ready = useRef(onReady)
  const initial = useRef(options)
  useEffect(() => { ready.current = onReady }, [onReady])
  useEffect(() => {
    if (!canvas.current) return
    const core = createCore(canvas.current, initial.current)
    ready.current?.(core)
    return () => { core.destroy(); ready.current?.(null) }
  }, [])
  return <canvas ref={canvas} className={className} aria-hidden="true" />
}
