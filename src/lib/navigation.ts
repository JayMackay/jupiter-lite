import { setPreview } from '../desktop/client'
import { openDashboardWindow } from './dashboard-open'

export type NavigationTarget = 'ribbon' | 'workspace' | 'capabilities' | 'help' | 'dashboard'
export const NAVIGATION_EVENT = 'jupiter-navigate-surface'
let revision = 0

// Notify in the click handler: related surfaces close in the same React update.
// The returned guard prevents a slow Help request from replacing a newer choice.
export function navigateSurface(target: NavigationTarget) {
  const current = ++revision
  if (target === 'workspace' || target === 'help') openDashboardWindow('home')
  if (target !== 'ribbon') setPreview(null)
  window.dispatchEvent(new CustomEvent<NavigationTarget>(NAVIGATION_EVENT, { detail: target }))
  return () => current === revision
}
