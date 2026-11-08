// Opening a dashboard window from elsewhere in the app, such as Files › archive.
export type DashboardWindow = 'archive' | 'home'
let pending: DashboardWindow | null = null
export const OPEN_WINDOW_EVENT = 'jupiter-open-dashboard-window'
export function openDashboardWindow(view: DashboardWindow) {
  pending = view
  if (view !== 'home' && !/^#\/?$/.test(location.hash)) location.hash = '#/'
  window.dispatchEvent(new CustomEvent(OPEN_WINDOW_EVENT, { detail: view }))
}
export function takePendingWindow() { const view = pending; pending = null; return view }

// The red trash can in an expanded window: anything dropped inside its circle is thrown away.
export function overTrash(x: number, y: number) {
  const box = document.querySelector('[data-trash]')?.getBoundingClientRect()
  return !!box && x >= box.left - 10 && x <= box.right + 10 && y >= box.top - 10 && y <= box.bottom + 10
}
