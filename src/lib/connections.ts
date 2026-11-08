import { api } from '../desktop/client'

export type ConnectionState = 'online' | 'ready' | 'setup' | 'problem' | 'off' | 'managed'
export interface Check { status: 'available' | 'agent-auth' | 'timeout' | 'unavailable'; toolCount: number | null; moreTools?: boolean; checkedAt: string; stale?: boolean }
export interface Server {
  id: string; name: string; client: string; scope: string; enabled: boolean; readiness: string; transport: string
  endpoint: string; executable: string | null; plugin: string | null; synced?: boolean; missingEnv: string[]
  canCheck: boolean; connection: Check | null; state: ConnectionState; project: string
}
export interface ConnectionsSummary { total: number; online: number; ready: number; setup: number; problem: number; off: number; managed: number; tools: number }
export interface Connections {
  scannedAt: string; scanned: number; summary: ConnectionsSummary
  everywhere: Server[]; projects: { path: string; name: string; workspace: boolean; servers: Server[] }[]; problems: { path: string; message: string }[]
}

export const loadConnections = () => api<Connections>('/connections')
