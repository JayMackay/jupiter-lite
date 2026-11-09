import type { ThemePreference } from '../../desktop/service/appearance.mjs'

export type AgentId = 'codex' | 'claude' | 'antigravity' | 'opencode' | 'kimi' | 'shell'
export interface AgentInfo { id: AgentId; label: string; color: string; available: boolean; subscription: boolean }
export interface ChatSession {
  id: string; name: string; agent: AgentId; cwd: string; bypass: boolean
  effort?: 'medium' | 'high' | 'xhigh' | 'max'
  status: 'starting' | 'running' | 'stopped' | 'exited'; createdAt: string
  lastOutputAt: string | null; lastInputAt: string | null; nativeId: string | null
  attention: boolean; cols: number; rows: number; exitCode?: number | null
  activity: 'idle' | 'working' | 'waiting'; unread: boolean; completionVersion: number
  tabOrder: number; tabColor: string | null; group: string | null
  open: boolean; pinned: boolean; updatedAt: string; preview?: string; hasConversation?: boolean; restoreError?: string | null
}
export interface ChatProject { name: string; path: string }
export interface ChatProjects { root: string; projects: ChatProject[]; custom?: boolean }
export interface RecentProject { path: string; name: string; sources: ('workspace' | 'jupiter' | 'claude' | 'codex')[]; pinned: boolean; lastUsedAt: string | null }
export interface Handoff { status: 'summarizing' | 'opening' | 'done' | 'failed'; error?: string | null; sessionId?: string | null; file?: string | null; at: string }
export interface Notice { id: string; sessionId: string; name: string; kind: string; text: string; at: string }
export interface Operation { id: string; text: string; status: string; result?: string; at: string; images?: string[]; conversation?: string }
/** Jupiter's own conversations, listed in the Activity tab. */
export interface JupiterChat { id: string; title: string; named: boolean; created: string; updated: string }
export interface JupiterChatList { active: string | null; chats: JupiterChat[] }
export interface Settings { defaultAgent: AgentId; ownerName?: string; nickname?: string; setupDone?: boolean; projectsDir?: string | null; transcribeProvider?: 'local' | 'openai' | 'openrouter' | 'off'; defaultBypass: boolean; terminalFontSize?: number; terminalAppearance?: 'focus' | 'original'; workspaceTheme?: ThemePreference; chatTheme?: ThemePreference; workspaceRoute?: string | null; selectedId?: string | null; coordinatorEffort?: 'medium' | 'high'; voiceName?: string; voiceStyle?: string; handoffAfter?: number; terminalOptionMeta?: boolean; collapsedGroups?: string[]; groupColors?: Record<string, string>; systemEvents?: SystemEventsMode }
export type SystemEventsMode = 'full' | 'compact' | 'hidden'
export interface VoiceOwner { clientId: string; surface: 'chats' | 'workspace' }
export interface FileEntry { name: string; path: string; directory: boolean; size: number; modifiedAt: string | null }
export interface Folder { path: string; parent: string; entries: FileEntry[]; truncated: boolean; mode: string }
export interface Preview { path: string; name: string; size: number; kind: 'document' | 'image' | 'video' | 'audio' | 'text' | 'unsupported'; url?: string; text?: string; revision?: string; reason?: string }
export interface DesktopState {
  ready: boolean; connected: boolean; error: string | null; repo: string; contentBase: string
  agents: AgentInfo[]; sessions: ChatSession[]; selectedId: string | null; notices: Notice[]
  settings: Settings; coordinator: string; voice: { configured: boolean; owner: VoiceOwner | null }
  operations: Operation[]; preview: Preview | null; jupiterChats: JupiterChatList
  voiceHistory: { id: string; at: string; captions: { role: 'user' | 'assistant'; text: string; start: number; end: number }[] }[]
}
export interface ServiceEvent {
  kind?: string; url?: string | null; text?: string; cached?: boolean; then?: string[]; pause?: number
  type: string; id?: string; data?: string; sequence?: number; session?: ChatSession; sessions?: ChatSession[]
  selectedId?: string; sessionId?: string; state?: string; error?: string; notice?: Notice
  operation?: Operation; chats?: JupiterChatList; settings?: Settings; owner?: VoiceOwner | null; window?: string; route?: string; preview?: Preview; handoff?: Handoff
  /** workspace-changed: the page file that changed, relative to the repo. */
  path?: string
  /** setup-progress: one starter tool's state, the finished run, or why it stopped. */
  progress?: StarterProgress; done?: { results: { id: string; name: string; ok: boolean; error?: string }[]; starter: StarterItem[] }
}
export interface SetupAgent { id: 'git' | 'node' | 'claude' | 'codex'; label: string; requirement?: boolean; installed: boolean; signedIn: boolean; install: string | null; docs: string; note?: string }
export interface StarterItem { id: string; name: string; what: string; cat: string; state: string }
export interface StarterProgress { id: string; name: string; state: 'installing' | 'installed' | 'failed'; error?: string }
export interface SetupState {
  done: boolean; profile: { name: string; nickname: string }; projects: { root: string; custom: boolean }
  agents: SetupAgent[]; starter: StarterItem[]; starterRunning: boolean; elevenlabs: { configured: boolean; voiceId: string | null }
}
