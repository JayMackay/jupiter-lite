# Everyday use

Work with your agents in Chats. Read, compare and keep their results in Workspace.
Your project folders connect the two.

## Start with one task

1. In Chats, press **+**, choose your agent and its working folder, and give the
   conversation a clear name.
2. Describe the result you want. Drop reference files or folders into the chat
   when they help: “Compare these concepts and put the findings in a Workspace card.”
3. Let the agent work. A glowing logo marks activity; an unread marker helps you
   find a result you have not reviewed yet.
4. Open the Workspace card, compare its tabs and images, then give your decision
   back to the chat: “Use version B. Keep its shape and change only the material.”
5. Keep related revisions as tabs in the same card. Archive the card when you no
   longer need it in the active list; its files are kept.

## Chats and Workspace

**Chats** holds real terminal sessions for Claude Code and Codex. **Workspace**
holds the cards, reports, previews and files they produce. Chats is docked on
the right: drag its divider to resize it, use X to hide it, and reopen it with
the Chats icon in the left navigation. Hiding keeps the sessions running.

Drag chat tabs to reorder them. Pinned tabs stay ahead of ordinary ones. Use
History to find and pin conversations you want to return to.

## Projects

The project picker lists the folders in your projects folder. Choose
**Change folder…** to point Jupiter at a different one, or **Use default** to go
back to the `projects` folder inside your workspace.

## Files and previews

**Files** shows the actual folders. Select a file to preview it. Images can be
enlarged and downloaded, and Markdown opens with **Preview** and **Edit** modes.

| Folder | What belongs here |
| --- | --- |
| `inbox/` | References, clipboard screenshots and incoming material |
| `projects/` | Ongoing project context and working specifications |
| `workspace/` | Cards, reports, previews and task deliverables |
| `knowledge/` | Lessons that should guide future work |
| `processes/` | Repeatable workflows and checklists |
| `.claude/skills/`, `.agents/skills/` | Skills for Claude Code and Codex |

Dropping files into Chats inserts their paths. Pasting a clipboard image saves
it in `inbox/` and inserts that path. Delete moves a file to the Recycle Bin
(the Trash on macOS and Linux).

## Skills, tools and capabilities

A **skill** explains how to do a recurring task: decisions, prompts, checks and
sometimes helper scripts. An **MCP server** connects an agent to a tool or
service, such as a browser or a documentation index.

Open **Capabilities** to see what is installed, check for updates and add more.
Each tool is pinned to a reviewed version; **Check again** compares it with the
latest one. Paid services such as Higgsfield, fal.ai and Firecrawl stay optional
and use your own accounts.

## Talking to Jupiter

Press the **J** button to start or stop a voice conversation. Ask for quick
actions such as opening a chat, finding a card or changing a card's status.
For a larger task, ask Jupiter to start an agent chat and follow its result.
With an ElevenLabs key, Jupiter also reads its replies aloud.

## Useful controls

| Control | Behavior |
| --- | --- |
| Ctrl+C in an agent chat (Windows, Linux) | Copy selected text; it does not interrupt the agent |
| Ctrl+Shift+C (Windows, Linux) | Copy selected text |
| Ctrl+C in a PowerShell or shell chat | Normal interrupt |
| ⌘C in any chat (macOS) | Copy selected text |
| Ctrl+V in a chat (⌘V on macOS) | Paste text or a clipboard screenshot |
| Ctrl+S while editing Markdown (⌘S on macOS) | Save the document |
| Escape in an image preview | Close the enlarged image |

## Keep the Workspace understandable

- Use clear card titles and chat names.
- Put revisions of the same task in one card, with readable tab names.
- Make images openable and downloadable. Keep editable sources beside results.
- Record what was checked and what still needs a decision.
- Archive finished work instead of mixing it into the current list.
