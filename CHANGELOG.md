# Changelog

## 0.1.0 · 2 November 2026

The first Jupiter build. Licence terms are in [LICENSE](LICENSE); open-source
components are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

- **Home dashboard:** liquid-glass panels over Jupiter's neural core, with today's
  one thing, an Ask bar that starts agent chats, Projects, To-do, World news and
  Brainstorm. The one thing, to-dos and ideas are Markdown files in `knowledge/`.
- **Connections dashboard:** every MCP server across Claude Code, Codex, Kimi,
  Cursor and Antigravity, for the workspace and recent projects, with on-click checks.
- **Capability manager:** the chosen Harness, Skills, Memory, Tools and Token Bill picks, each
  reviewed and pinned to an exact commit or version before it installs. Installs go through Claude
  Code and Codex's own mechanisms, MCP tools can be switched on per project, and removal undoes
  exactly what was installed. Everything is recorded in `knowledge/capabilities.lock.json`.
- **Plugins and MCP pages:** only what's installed, grouped by section. Check for updates shows
  green, orange or red per item, and clicking an orange item updates it in place. Titles link to
  GitHub or each tool's own site.
- **Codex and Claude Code only** for new chats.
- **Tool rules:** shared rules that tell both agents when to use the installed tools.
- **Jupiter identity:** name, icons (the transparent J mark), the Jupiter colour palette, a
  Friday-style voice persona, its own app identifier and `jupiter.exe`.
- **Internal names:** components, CSS classes, data attributes, events, storage keys,
  environment variables and the settings folder now use Jupiter names. A workspace
  that still has the old settings folder is moved to `.jupiter` on first start.
