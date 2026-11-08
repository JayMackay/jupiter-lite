import { api } from '../desktop/client'
import { navigateSurface } from './navigation'
import { takePendingWindow } from './dashboard-open'

export type CapabilityState = 'installed' | 'present' | 'available' | 'manual' | 'have' | 'skip' | 'reference'
export type Category = { id: string; label: string; blurb: string }
export type Capability = {
  id: string; cat: string; name: string; title?: string; desc?: string; repo?: string; url?: string; site?: boolean; status: 'take' | 'have' | 'skip' | 'reference'
  what: string; agents: string[]; missingEnv?: string[]
  /** The card's tags, built by the service from the catalogue's labels: type, then what it does, then an agent tag only if it works with just one. */
  cardTags?: string[]
  /** Agents it works with (verified in the catalogue or found configured): 'claude', 'codex'. */
  agentSupport?: string[]
  /** A visual editor the tool brings (Pixelbolt's studio), and whether it is running now. */
  editor?: { label?: string }; editorState?: { running: boolean; url: string | null }
  setup?: { kind: 'plugin' | 'skills' | 'mcp' | 'npm-cli' | 'uv-tool' | 'manual'; server?: string; url?: string }
  detect?: { mcp?: string[]; marketplace?: string }
  state: CapabilityState; found: string[]
  installed: null | { commit: string | null; version: string | null; installedAt: string; targets: string[]; hooks: number }
}
export type UpdateResult = { status: 'current' | 'update' | 'unsupported'; current?: string; latest?: string; hosted?: boolean; reason?: string }
export type Updates = { checkedAt: string; results: Record<string, UpdateResult> }
export type Capabilities = { categories: Category[]; items: Capability[]; projects: { path: string; name: string }[]; updates: Updates | null; lockFile: string }
export type Hook = { owner: string; event: string; matcher: string; command: string }
export type UpdateOutcome = { updated: boolean; confirm?: { hooks: Hook[] }; list: Capabilities }

export const loadCapabilities = () => api<Capabilities>('/capabilities')
export const checkForUpdates = () => api<Updates>('/capabilities/check-updates', {})
export const updateCapability = (id: string, acceptHooks = false) => api<UpdateOutcome>('/capabilities/update', { id, acceptHooks })
export const toolEditor = (id: string, action: 'open' | 'stop') => api<{ running: boolean; url: string | null; window?: boolean }>('/capabilities/editor', { id, action })

// Opening the Plugins or MCP page from anywhere: the rail, chips or Ask Jupiter.
export type CapabilityTab = 'harness' | 'skills' | 'memory' | 'tools' | 'tokens' | 'connections'
let requested: CapabilityTab | null = null
export const OPEN_EVENT = 'jupiter-open-capabilities'
export function openCapabilities(tab: CapabilityTab) {
  navigateSurface('capabilities')
  takePendingWindow()
  requested = tab
  if (!/^#\/?$/.test(location.hash)) location.hash = '#/'
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: tab }))
}
export function takeRequestedTab() { const tab = requested; requested = null; return tab }
