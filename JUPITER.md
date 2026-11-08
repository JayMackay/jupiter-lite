# Jupiter · project notes

Jupiter is a personal, local-first agent workspace. It started on 1 November 2026 as a copy
of your previous workspace app (`D:\Projects\JayAgenticWorkspace`), without its Git history,
dependencies, build output, chats or personal cards. The open-source notices in
`THIRD_PARTY_NOTICES.md` must stay.

## Built so far (2 November 2026)

- **Identity:** the name Jupiter everywhere, your transparent J mark exactly as supplied
  (`public/assets/jupiter-mark.png`, also `jupiter.png`, `jupiter-192.png`, `jupiter-512.png`
  and every icon in `src-tauri/icons`, Chats included), the voice button as a round J in the
  left rail above the Chats button, the Jupiter colour palette as default, its own identifier (`com.jupiter.workspace`) and
  executable (`jupiter.exe`), and launchers `Start Jupiter.cmd/.ps1/.command`.
- **Internal names:** components (`JupiterLogo`, `JupiterCard`, `JupiterText`,
  `JupiterComposer`, `JupiterImages`), CSS classes (`jupiter-*`), report attributes
  (`data-jupiter-report`, `data-jupiter-theme`, `data-jupiter-zoom`), events, storage keys,
  environment variables (`JUPITER_*`) and the settings folder (`.jupiter`).
- **Neural core:** `src/lib/neural-core.mjs` (+ `.d.mts`) and `src/components/NeuralCore.tsx`.
- **Dashboard home:** `src/components/Dashboard.tsx` and `src/styles/dashboard.css`. Real data
  only: Workspace cards, live agent chats, focus timer, clock. Today's one thing, the to-do
  list and brainstorm ideas are Markdown in `knowledge/` through
  `desktop/service/jupiter-home.mjs` (`GET/POST /api/jupiter/home`). News shows
  "not connected" until feeds exist. Ask Jupiter runs dashboard commands locally and starts
  an agent chat for anything else.
- **Connections dashboard:** `desktop/service/connections.mjs` (`GET /api/connections`,
  `POST /api/connections/check`) and `src/components/ConnectionsView.tsx`: every MCP server
  across Claude Code, Codex, Kimi, Cursor and Antigravity for the workspace and up to 16
  recent or pinned projects, with on-click checks. Credential values never reach the UI.
- **Voice persona:** Friday-style default (warm, quick, soft Irish lilt), voice `marin`.
- **Capability manager:** `desktop/service/capabilities.mjs` (`GET /api/capabilities`,
  `POST /api/capabilities/review|install|remove`) and `src/components/CapabilitiesView.tsx`,
  opened from the Capabilities chip, All panels, or by asking "show my capabilities".
  - The picks and reasons are in `knowledge/capabilities.json` (built from the design card's
    catalogue). Each install is logged in `knowledge/capabilities.lock.json`.
  - **Review** pins the latest commit or package version. For repositories it fetches exactly that
    commit into `.jupiter/capabilities/` with git hooks disabled. It then lists hooks, MCP servers,
    skills, commands, install scripts and any code fetched from outside the pin.
  - **Install** only runs with that review's one-time token, which lasts 30 minutes. Hooks need a
    tick to confirm you've read them. A failed step rolls back what had already run.
  - **Install methods:** Claude plugins go through a marketplace added from the pinned checkout.
    MCP tools go through `claude mcp add` / `codex mcp add` with a pinned `npx` version, and can be
    switched on everywhere or per project. Skills are copied to `~/.claude/skills` and
    `~/.agents/skills` with a marker file. CLIs use `npm -g` (install scripts skipped unless the
    catalogue allows them) or `uv tool`.
  - **Keys:** only variable names are recorded. Codex gets `env_vars`; GitHub uses the read-only
    endpoint with `GITHUB_PAT_TOKEN`.
  - **Remove** undoes exactly what Jupiter recorded. It never touches a skill, marketplace or Codex
    block that it didn't add.
  - rtk is set up by hand (the rtk-oss zip); unity and blender are detected as already set up.
- **Plugins and MCP pages:** the rail's **Plugins** and **MCP** buttons, the dashboard chips and
  Ask Jupiter all open the Capabilities view (`openCapabilities()` in `src/lib/capabilities.ts`).
  - It lists only what's installed, under Harness, Skills, Memory, Tools and Token Bill, plus a
    Connections tab with one row per MCP server.
  - **Check for updates** (`POST /api/capabilities/check-updates`) compares each pick with its
    latest GitHub commit, npm version or PyPI version. Results are kept in
    `.jupiter/capabilities/updates.json`.
  - An orange **Update available** status runs `POST /api/capabilities/update`. That reviews the
    new version, reinstalls it in the same places and pins it.
    - It asks first if the update changes the hooks.
    - If the update fails, the previous version is put back.
  - Project skill files now open from the Files panel's **skills** shortcut.
- **Chats:** new chats offer Codex and Claude Code only (`src/lib/agents.ts`). Old chats from
  other agents still open from History.
- **Tool rules:** `knowledge/instructions/tool-rules.md` is copied between marker lines into
  `~/.claude/CLAUDE.md` and `~/.codex/AGENTS.md` whenever Jupiter starts
  (`desktop/service/agent-rules.mjs`).
- **Copy style:** no hyphens or dashes in on-screen text.
- **Dashboard (2 November):**
  - Expanded windows are larger, with a clearer glass background and solid cards inside. No
    scrollbars are visible anywhere on the dashboard.
  - The Capabilities, Connections and node colour chips are gone; the core is always rainbow.
  - Dragging a card shows the real card under the pointer.
  - Projects and Brainstorm have a red trash can next to close; its lid opens as you drag over it.
    - A card dropped in it leaves the board and its folder goes to the Recycle Bin
      (`DELETE /api/workspace/entities/:id`).
    - An idea dropped in it is removed until you Save; Discard brings it back.
  - Pinned cards can't be dragged.
  - **Files › archive** opens the Archive window, with Unarchive on each card.
- **Brainstorm whiteboards:** `src/components/BrainstormBoard.tsx`, `src/styles/whiteboard.css`
  and `desktop/service/boards.mjs` (`/api/boards`).
  - Each board is saved under its title as `knowledge/boards/<name>.json`, with a readable
    `<name>.md` next to it. The old brainstorm notes became the "Brainstorm" board.
  - The top toolbar has Select, Note, Shape (rectangle, ellipse or diamond), Connect, Pen (colour,
    and fine, medium or sharpie thickness), Highlight, Eraser, Image, Undo and Redo.
  - Paste images, GIFs, links or text onto the board. Images are saved in `inbox/attachments`.
  - Drag an item out of the window to throw it away (Undo brings it back).
  - The board pans when you drag empty space or scroll, and Ctrl plus scroll zooms.
  - The idea box shows a different greeting each time. The liquid glass + opens Mic, Save and
    Discard. Ctrl+S saves.
  - Connect is click and drag from one item to another. Pen, Highlight and Eraser show their icon
    as the cursor.
  - Pen and highlighter ink is drawn above the cards, so a highlight lands on the text.
  - Images resize from the corner handle and keep their shape.
- **Token usage:** `desktop/service/token-usage.mjs` (`GET /api/tokens`) and
  `src/components/TokenUsage.tsx`.
  - It reads only the usage numbers in Claude Code (`~/.claude/projects`) and Codex
    (`~/.codex/sessions`) logs, never the conversation text.
  - The home panel shows this week's total, today, and a seven day chart.
  - The window shows today, 7 days and 14 days, usage by day, where it went (cache, input,
    output) and usage by model.
- **News:** `desktop/service/news.mjs` (`GET /api/news?topic=ai|uk|world`, `GET /api/news/overview`)
  and `src/components/NewsView.tsx`.
  - Sources are listed in `knowledge/news/feeds.json` (written with defaults on first use; edit
    freely):
    - AI: The Verge, TechCrunch, MIT Technology Review, Ars Technica, The Guardian, OpenAI, Google
      DeepMind, Hugging Face.
    - UK: BBC News, The Guardian, Sky News.
    - World: BBC News, The Guardian, Al Jazeera, Sky News.
  - The service fetches the feeds and keeps only plain text. Feeds are cached for 20 minutes, a
    source that is down keeps its last headlines, and an `exclude` pattern can drop stories that
    belong to another topic.
  - YouTube clips in stories show **Watch** and play in a minimal player inside Jupiter (the
    privacy enhanced youtube-nocookie player; the app's `frame-src` allows only that). Other
    video stories show **Video** and open on the publisher's site.
  - The home screen has five panels: Projects, To do, News, Token usage and Brainstorm.
- **Work board (To do):** `src/components/WorkBoard.tsx`, `src/styles/work-board.css` and
  `desktop/service/work-items.mjs` (`/api/work`).
  - A kanban board with To do, In progress, Testing and Done columns. Items are Features, Bugs or
    Spikes (research); each has child tasks with checkboxes and a count like 2/3. Drag cards
    between columns.
  - Click a title to edit its Markdown details and acceptance criteria (toolbar plus preview),
    type, state, priority, due date, tags and tasks. Tasks expand to their own state and details.
  - Cards show a priority flag, due date (amber within 2 days, red when overdue), up to 3 tags
    and how long the item has been in flight. The top bar filters by text, type and tag.
  - Boards are switchable and can be linked to a project. Each is stored as
    `knowledge/work/<board>.json` plus a readable `.md`. Older items' projects became tags and
    older top level tasks became features.
  - "add …" in Ask Jupiter puts a feature in To do.
  - **In progress limit:** set per board by clicking the column count (In progress defaults to 3; Testing has none). Over the limit, the column turns amber and says so; drops are never blocked.
  - **This week:** shows items done in the last 7 days (or last week), counts by type, average time to done, and items still in flight for over 7 days. Copy it as Markdown, or save it to knowledge/work/<board>-week-<date>.md.
- **Ask Jupiter:** pasted or dropped screenshots are saved in `inbox/attachments` and passed to
  the chat it starts.

## Desktop app

Build with `npm run desktop:build -- --no-bundle`, then open **Start Jupiter.cmd**. The app
bundles its own copy of the interface and service, so rebuild after changing either. It runs
alongside your previous workspace app without sharing settings; agent CLI logins are shared.
The Windows-key recall shortcut is off by default.

## Checks

Lint, typecheck, build, template and skills-sync checks pass.

- **Unit tests** pass except `quick-actions.test.mjs`, a Windows text-encoding problem that predates
  Jupiter. `capabilities.test.mjs` covers the capability manager with stand-in CLIs.
- **Browser tests:** `ui`, `links-ui`, `theme-ui` and `mobile-ui` stop at points that also fail in
  an untouched copy of the original app.
  - `history-ui` is timing-sensitive on this PC. It passes with a longer wait for the resumed
    terminal.
  - `capabilities-ui` drives review, hook acknowledgement, install, per-project tools and removal
    without installing anything.

## Next

1. Install the picks you want from Capabilities, one at a time, reading each review.
2. Refresh the screenshots in `docs/assets`; they still show the previous app's look.
3. Optionally `git init` to start Jupiter's own history.

## Voice: Hey Jupiter and ElevenLabs

- **Listening:** `desktop/service/wake-listener.py`, run by `desktop/service/wake-word.mjs` with the
  local Whisper install in `.cache/dictation` (`scripts/setup-local-dictation.ps1`, which now also
  installs `sounddevice` for the microphone).
  - Speech is checked on this PC by Whisper, and nothing is recorded or sent.
  - "Hey Jupiter, …" passes on the words after it; "Hey Jupiter" on its own waits seven seconds
    for the request. A mention of Jupiter mid sentence is ignored.
  - The listener pauses while Jupiter speaks, so it never hears itself, and restarts if the
    microphone drops.
  - It runs only in the desktop app (`voiceOptions.listen` in `main.mjs`). Switch it off in
    Settings › Voice.
- **Thinking:** the words go to Jupiter's assistant (`/api/coordinator`, your Codex account).
- **Speaking:** `desktop/service/voice-out.mjs` uses ElevenLabs with `ELEVENLABS_API_KEY`,
  `ELEVENLABS_VOICE_ID` and `ELEVENLABS_MODEL` from `.env`.
  - Every clip is kept in `knowledge/voice/clips` (with `index.json`). The phrase bank of 33
    common lines (wake, working, done, greetings and so on) was made once. Replies up to 220
    characters are saved the first time and replayed free after that.
  - Long answers are spoken as their opening sentences plus "The rest is on screen."
  - Without credits or a connection, Windows' own voice reads the reply.
  - Routes: `GET /api/voice`, `POST /api/voice/wake|say|played|prepare`, and
    `GET /api/voice/clip/:file`.
- Settings › Voice shows the listener's state and microphone, the ElevenLabs credits used, and
  a Test the voice button.
- **Wake word:** "Jupiter" or "Hey Jupiter" at the start of what you say. It's ignored mid
  sentence. Whisper's speech detection and confidence scores drop noise, claps and typing.
  `wake-listener.py --check <files>` reports what each recording would do.
- **Conversation:** after each answer Jupiter listens 10 more seconds without the wake word.
  "Thanks Jupiter, I'll take it from here", "that's all", "stop listening" and similar end it.
- **Navigation:** voice commands starting "open", "show", "close", "go to" and so on run on screen
  through the dashboard's `navigateTo`, the same rules as the Ask bar. Anything else goes to the
  assistant.
  - Assistant tools: `show_view`, `list_boards`, `open_board` (creates a board by title) and
    `add_to_board` (cards and connections by card text).
- **The J button:** without an OpenAI key it listens for one request through the local voice,
  instead of asking for a key.
- **Brain:** it listens, thinks and speaks along with the voice.
- **Greeting:** a rotating, time of day greeting is spoken once each time Jupiter opens.
- **Long first messages:** a brief for a new chat that can't go on the command line (several
  lines or quotes) is saved to `inbox/briefs/` and the chat is told to read it. This fixes Brief me
  and Start a chat on this.
- **Work items by voice:** `add_work_item` adds a Feature, Bug or Spike with optional details,
  acceptance criteria, tasks, tags and priority, and shows the board.
  - `start_work_chat` hands an item to Claude Code (or Codex). The brief goes in `inbox/briefs`.
    `goal: shape` asks it to write details, acceptance criteria and tasks into the board file;
    `build` does the work and moves the item to In progress.
- **Ticket requests (04/11/2026):** "create a feature ticket to …, have Codex write the details" is recognised in the Ask bar,
  the Jupiter chat and by voice (`desktop/service/ticket-requests.mjs`, the same rules in the interface and the service),
  and saved by `add_work_item` (`desktop/service/tickets.mjs`) as one Feature on the named or latest board. A repeat finds the
  ticket already there; an unknown board is an error, never a new board. Codex drafts the details by default in a visible
  chat ("without Codex" or "just the title" skips it, "have Claude" picks Claude). The reply says the details are not saved
  yet; Jupiter says they are saved only after the chat has finished and the board really holds them.
- **Workspace card links (04/11/2026):** a card link in a chat or terminal (`#/<id>`, `#/<id>/<page>` or a local address with a
  registered card) opens in the Workspace window through `POST /api/workspace/link`; unknown cards say so; other links open in the
  browser as before. `npm run dev` no longer opens a browser (Setup Preview passes `--open`).
- **Voice quality:** phrase bank lines and replies up to 60 characters use
  `ELEVENLABS_PHRASE_MODEL` (default `eleven_multilingual_v2`), because Flash garbles very short
  lines. Longer replies use `ELEVENLABS_MODEL`. Clips play strictly one after another.
- **Bottom left:** the rail's Chats button opens the Chats window. The extra conversation button
  beside the J is hidden; the J opens the conversation and its × closes it.

## Voice briefings and project maps (02/11/2026)
- `desktop/service/briefings.mjs`: weather (Open-Meteo, no key; location in Settings › Voice, default London), spoken news by topic (ai, agentic, tech, uk, world, gaming, finance), and project maps.
- "Jupiter scan test" / "map my test project" / "read test again": opens a Claude Code chat in `projects/<name>` that runs graphify, uses repomix or agentmemory if needed, and writes `PROJECT_MAP.md` there. The brain shows the reading animation (signals hopping node to node) until it finishes.
- Coordinator tools: get_weather, get_news, map_project.

## Window greetings, brain and layout (03/11/2026)
- `desktop/service/greetings.mjs`: about 20 lines each for Brainstorm, To do and Projects (any time plus morning, afternoon, evening, late), spoken by `/api/voice/greet` at most once per 90 s per window. News reads the open tab's top headline with a personal opener (uses ElevenLabs credits).
- Brain (`src/lib/neural-core.mjs`): rounder shell (760 nodes), thinking and reading show up to 5 signals hopping along links with 2 s colour flashes, orange core pulsing with speech.
- Layout: no top header on home; Workspace button (document icon) under Files; left rail hidden by default with an edge arrow; New card lives in the Projects window. Shared `BoardMenu.tsx` for To do and Brainstorm.
- Local Read aloud (Kokoro) installed in `.cache/read-aloud`.

## Final refinements (04/11/2026)
Decisions to keep:
- **J button** is a toggle; a second press cancels listening (`{"cancel":true}` to the listener) and plays a saved farewell, sometimes with a title clip (Sir, Boss, Jay). Clips are recorded once.
- **Chat window** resizes from a grip in the top right of its header, beside lock and Close (moved there on 4 November at Jay's request; it was bottom right). The bottom left stays fixed, so dragging that corner up and right grows it (Jay's choice). It drags only when unlocked and resets on close. Conversations live in `.jupiter/jupiter-chats*`, one assistant thread each.
- **Rail** hides 7 seconds after the pointer leaves (`RAIL_HIDE_MS`).
- **Dashboard hero** is one large greeting (`src/lib/greeting.ts`): a short phrase for the local time and the configured owner name, chosen once per visit and never the same as the last visit. The editable "one thing today" is gone; what was saved stays in `knowledge/`, and `/api/jupiter/home` still serves it.
- **Tool tags** come from catalogue `labels` plus checked `agentSupport`; at most five, an agent tag only when one agent is supported.
- **Pixel tools**: PixelFX, Claude PXL and Pixelbolt installed through the capability manager (shared checkouts in `.jupiter/tools`). Pixelbolt's studio opens in its own Jupiter window, because it forbids frames.
- **Brainstorm**: nine fill colours (`--bd-*`), notes resize only from the corner and keep their shape (Jay's choice), images resize freely (Shift keeps proportions).
  - **Shape text**: type on a selected shape or note (or press Enter or F2, or double click) to edit it. Escape only leaves the editor. Shape text sits in `.jh-bd-shape-body`, inset by percentages of the shape, so it stays inside ellipses, diamonds and triangles.
- **To do**: Backlog (stored `todo`), In progress, Done. Testing retired. Refinement is a property; work cycles drive the calendar.
  - **Side panel** (right of the three columns, `SidePanel` in `WorkBoard.tsx`, figures in `src/lib/work-overview.ts`): the Project overview (health, Next up with a Start action, refinement queue, Due soon) until a card is clicked, then that ticket's preview with quick actions and Open full editor. Clicking a card previews it; the big editor only opens from the panel. It collapses to a rail and moves under the columns on a narrow board.
  - **Task time**: tasks have work cycles like tickets. A task that never entered In progress shows only its created date and "not started yet".
  - **Start a chat on this** opens a chat that reads the ticket and waits; it changes nothing on the ticket. `start_work_chat` by voice does the same with no `goal`; `goal: shape` and `goal: build` keep their behaviour.
