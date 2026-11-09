import { useEffect, useState } from 'react'
import { api } from './client'

type Update = { state: 'available' | 'installing' | 'error' | 'current' | 'unavailable'; version?: string; message?: string }
type Info = { version: string | null; enabled: boolean }

// Manual check for app updates; the shell answers with a 'jupiter-update' window event.
export default function UpdateSettings() {
  const [info, setInfo] = useState<Info | null>(null)
  const [update, setUpdate] = useState<Update | null>(null)
  const [checking, setChecking] = useState(false)
  useEffect(() => {
    api<Info>('/update').then(setInfo).catch(() => setInfo({ version: null, enabled: false }))
    const heard = (event: Event) => { setChecking(false); setUpdate((event as CustomEvent<Update>).detail) }
    window.addEventListener('jupiter-update', heard)
    return () => window.removeEventListener('jupiter-update', heard)
  }, [])
  const check = () => { setChecking(true); setUpdate(null); api('/update', { action: 'check' }).catch(() => setChecking(false)) }
  const install = () => { api('/update', { action: 'install' }).catch(() => {}) }
  const status = checking ? 'Checking…'
    : update?.state === 'current' ? 'You have the latest version.'
    : update?.state === 'available' ? `Jupiter ${update.version} is ready to install.`
    : update?.state === 'installing' ? `Installing Jupiter ${update.version}… it will restart by itself.`
    : update?.state === 'error' ? `The check could not finish: ${update.message}`
    : update?.state === 'unavailable' ? 'Updates are available in the installed app.'
    : ''
  return <section><h3>Updates</h3>
    <p>{info?.version ? `Jupiter ${info.version}. ` : ''}Jupiter checks for new versions by itself; you can also check now.</p>
    <div className="settings-actions">
      <button type="button" className="desk-secondary" disabled={checking || update?.state === 'installing' || info?.enabled === false} onClick={check}>Check for updates</button>
      {update?.state === 'available' && <button type="button" className="desk-primary" onClick={install}>Install and restart</button>}
    </div>
    {info?.enabled === false && <p>Updates are available in the installed app, not when running from source.</p>}
    {status && <p role="status">{status}</p>}
  </section>
}
