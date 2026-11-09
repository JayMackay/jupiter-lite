import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties } from 'react'
import App from '../App'
import { useWorkspaceTheme } from '../lib/workspace-theme'
import { useExitTransition } from '../lib/useExitTransition'
import { themeVariables } from '../../desktop/service/appearance.mjs'
import { dismissError, OPEN_SETUP_EVENT, sendEvent, startDesktop, surface, useDesktop } from './client'
import FilesRail, { FilePreview } from './FilesRail'
import VoiceDock from './VoiceDock'
import UpdateBanner from './UpdateBanner'
import { Icon, Nose } from './Icons'
import './desktop.css'

const Chats = lazy(() => import('./Chats'))
const SetupWizard = lazy(() => import('./SetupWizard'))

export default function DesktopApp() {
  const state = useDesktop()
  const preview = useExitTransition(state.preview)
  const [visible, setVisible] = useState(true)
  const [setupOpen, setSetupOpen] = useState(false)
  // Setup steps aside while an install or sign-in runs in a chat terminal.
  const [setupAside, setSetupAside] = useState(false)
  const [width, setWidth] = useState(() => Math.max(330, Math.min(Number(localStorage.getItem('jupiter.chatWidth')) || 420, window.innerWidth - 674)))
  const panel = useRef<HTMLElement>(null)
  const { resolved } = useWorkspaceTheme('chat')
  const resize = (value: number) => setWidth(Math.max(330, Math.min(value, window.innerWidth - 674)))
  useEffect(() => {
    const show = () => { setVisible(true); requestAnimationFrame(() => { panel.current?.focus(); panel.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus() }) }
    const fit = () => setWidth(value => Math.max(330, Math.min(value, window.innerWidth - 674)))
    window.addEventListener('jupiter-show-chats', show)
    window.addEventListener('resize', fit)
    return () => { window.removeEventListener('jupiter-show-chats', show); window.removeEventListener('resize', fit) }
  }, [])
  useEffect(() => { localStorage.setItem('jupiter.chatWidth', String(width)) }, [width])
  useEffect(() => { startDesktop() }, [])
  useEffect(() => {
    const open = () => setSetupOpen(true)
    window.addEventListener(OPEN_SETUP_EVENT, open)
    return () => window.removeEventListener(OPEN_SETUP_EVENT, open)
  }, [])
  const firstRun = state.ready && state.settings.setupDone !== true
  const setupShown = setupOpen || firstRun
  const chatsShown = visible && (!setupShown || setupAside)
  useEffect(() => {
    if (surface !== 'workspace') return
    const route = () => sendEvent({ type: 'workspace-route', route: location.hash })
    window.addEventListener('hashchange', route)
    return () => window.removeEventListener('hashchange', route)
  }, [])
  if (!state.ready) return <div className="desktop-boot"><Nose size={70} /><h1>Jupiter</h1><p>{state.error || 'Opening your workspace…'}</p>{state.error && <button className="desk-secondary" onClick={() => startDesktop()}>Reconnect</button>}</div>
  return <div className={`desktop-root workspace-root`}>
    <FilesRail /><div className="workspace-surface"><App />{preview && <FilePreview file={preview} exiting={!state.preview} />}</div>
    {chatsShown && <div className="jupiter-splitter" role="separator" aria-label="Resize Chats" aria-orientation="vertical" aria-valuemin={330} aria-valuemax={Math.max(330, window.innerWidth - 674)} aria-valuenow={width} tabIndex={0}
      onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); resize(width + (event.key === 'ArrowLeft' ? 20 : -20)) } }}
      onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault() }}
      onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) resize(window.innerWidth - event.clientX) }}
      onPointerUp={event => event.currentTarget.releasePointerCapture(event.pointerId)} />}
    <aside ref={panel} className="jupiter-chats-panel" aria-label="Chats" tabIndex={-1} hidden={!chatsShown} style={{ width, ...themeVariables(resolved) } as CSSProperties}>
      <Suspense fallback={<div className="desktop-boot"><Nose size={50} /></div>}><Chats visible={visible} onClose={() => setVisible(false)} /></Suspense>
    </aside>
    {state.error && <div className="desktop-error" role="alert"><span>{state.error}</span><button onClick={dismissError} aria-label="Dismiss error"><Icon name="close" size={16} /></button></div>}
    {!state.connected && <div className="desktop-offline">Reconnecting to the local service…</div>}
    <UpdateBanner />
    {setupShown && <div className="setup-layer" hidden={setupAside}><Suspense fallback={null}><SetupWizard onClose={() => { setSetupOpen(false); setSetupAside(false) }} onStepAside={() => setSetupAside(true)} /></Suspense></div>}
    {setupShown && setupAside && <button className="desk-primary setup-return" onClick={() => setSetupAside(false)}>Back to setup</button>}
    <VoiceDock />
  </div>
}
