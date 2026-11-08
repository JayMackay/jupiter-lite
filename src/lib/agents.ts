// Jupiter offers new chats in Codex and Claude Code only. Chats made earlier with other
// agents still open from History.
export const CHAT_AGENTS: readonly string[] = ['codex', 'claude']
export const offered = <T extends { id: string }>(agents: T[]) => agents.filter(agent => CHAT_AGENTS.includes(agent.id))
