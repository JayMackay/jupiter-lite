import { useEffect, useState } from 'react'
import { api } from './client'

type Update = { state: 'available' | 'installing' | 'error' | 'current' | 'unavailable'; version?: string; notes?: string | null; message?: string }
const CHECK_EVERY = 6 * 60 * 60 * 1000

// The desktop shell checks GitHub Releases for a signed update and installs it when asked.
export default function UpdateBanner() {
  const [update, setUpdate] = useState<Update | null>(null)
  const [dismissed, setDismissed] = useState('')
  useEffect(() => {
    const heard = (event: Event) => setUpdate((event as CustomEvent<Update>).detail)
    window.addEventListener('jupiter-update', heard)
    const check = () => { api('/update', { action: 'check' }).catch(() => {}) }
    const first = window.setTimeout(check, 8000)
    const timer = window.setInterval(check, CHECK_EVERY)
    return () => { window.removeEventListener('jupiter-update', heard); window.clearTimeout(first); window.clearInterval(timer) }
  }, [])
  if (!update || !['available', 'installing', 'error'].includes(update.state)) return null
  if (update.state === 'available' && dismissed === update.version) return null
  if (update.state === 'error' && dismissed === 'error') return null
  return <div className="update-banner" role="status">
    {update.state === 'available' && <><span>Jupiter {update.version} is ready. Open chats close and reopen after the restart.</span>
      <button className="desk-primary" onClick={() => { api('/update', { action: 'install' }).catch(() => {}) }}>Install and restart</button>
      <button className="desk-secondary" onClick={() => setDismissed(update.version || '')}>Later</button></>}
    {update.state === 'installing' && <span>Installing Jupiter {update.version}… it will restart by itself.</span>}
    {update.state === 'error' && <><span>The update could not finish: {update.message}</span><button className="desk-secondary" onClick={() => setDismissed('error')}>Dismiss</button></>}
  </div>
}
