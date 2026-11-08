import { api, reportError } from './client'
import { mayBeCardLink } from '../../desktop/service/workspace-links.mjs'

interface LinkResult { handled: boolean; shown?: boolean; error?: string }

/** True when a link may point at a Workspace card, judged from its shape alone. The service decides for real. */
export const isCardLink = (href: string) => mayBeCardLink(href, window.location.origin)

/**
 * Opens a link from a chat or terminal. A registered Workspace card opens inside Jupiter, with the chat left
 * where it is; an unknown card says so. Every other link opens in the browser exactly as it did before.
 */
export async function openLink(href: string): Promise<void> {
  if (isCardLink(href)) {
    try {
      const result = await api<LinkResult>('/workspace/link', { href })
      if (result.handled) { if (result.error) reportError(new Error(result.error)); return }
    } catch { /* The service could not be asked, so the browser handles it as before. */ }
  }
  window.open(href, '_blank', 'noopener,noreferrer')
}
