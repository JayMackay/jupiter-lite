import http from 'node:http';
import path from 'node:path';
import { readFile, stat, realpath, mkdir, writeFile } from 'node:fs/promises';
import { watch } from 'node:fs';
import { WebSocketServer, WebSocket } from 'ws';
import { parse as parseEnv } from 'dotenv';
import { Sessions, chatProjects, createChatProject } from './sessions.mjs';
import { Coordinator, openChatArguments } from './coordinator.mjs';
import { createReadStream } from 'node:fs';
import { Files, serveFile } from './files.mjs';
import { importFile, dragFiles, moveFile, recyclePath, MAX_FILE_BYTES } from './file-transfers.mjs';
import { inventory } from './agents.mjs';
import { Attachments, attachmentText, MAX_IMAGE_BYTES } from './attachments.mjs';
import { ContextLibrary } from './context.mjs';
import { groupLabel, taskTitle } from './titles.mjs';
import { taskEffort } from './effort.mjs';
import { Workspace, localDay, metadataPatch } from './workspace.mjs';
import { CardDocuments } from './card-documents.mjs';
import { QuickActions } from './quick-actions.mjs';
import { JupiterChats } from './jupiter-chats.mjs';
import { ToolEditors } from './tool-editors.mjs';
import { defaultVoiceStyle, voiceSession } from './voice-profile.mjs';
import { NativeSettings } from './native-settings.mjs';
import { McpInventory } from './mcp.mjs';
import { body, equalSecret, json, publicError, readJson, realFile, saveJson, secret } from './util.mjs';
import { ProjectAdapterRegistry } from './project-adapters/registry.mjs';
import { KnowledgeManager, MarkdownKnowledgeProvider } from './knowledge/providers.mjs';
import { IntegrationManager } from './integrations/manager.mjs';
import { MobileDictation } from './mobile-dictation.mjs';
import { MobileGateway } from './mobile.mjs';
import { ConversationTranscripts } from './mobile-transcript.mjs';
import { ConversationMedia } from './conversation-media.mjs';
import { projectKey, recentProjects } from './recent-projects.mjs';
import { answerPrompt, readPrompt } from './terminal-prompt.mjs';
import { rewindToMessage } from './message-edit.mjs';
import { LocalReadAloud } from './local-read-aloud.mjs';
import { Handoffs } from './handoff.mjs';
import { chatCommands } from './chat-commands.mjs';
import { isThemePreference } from './appearance.mjs';
import { createJupiterHome } from './jupiter-home.mjs';
import { createWorkItems } from './work-items.mjs';
import { createTickets } from './tickets.mjs';
import { parseTicketRequest } from './ticket-requests.mjs';
import { cardLink, unknownCardMessage } from './workspace-links.mjs';
import { createBoards } from './boards.mjs';
import { createTokenUsage } from './token-usage.mjs';
import { createNews } from './news.mjs';
import { greetingKind, newsGreeting, newsKind } from './greetings.mjs';
import { createWeather, describeNews, findProject, matchProjectScan, NEWS_ASK, scanBrief, WEATHER_ASK } from './briefings.mjs';
import { createVoiceOut, PHRASES } from './voice-out.mjs';
import { WakeWord } from './wake-word.mjs';
import { randomUUID } from 'node:crypto';
import { ConnectionsOverview } from './connections.mjs';
import { Capabilities } from './capabilities.mjs';
import { agentStatus, elevenLabsStatus, elevenLabsVoices, saveElevenLabs, saveProfile } from './setup.mjs';
import { syncAgentRules } from './agent-rules.mjs';

const listen = server => new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)); });

export async function createService({ repo, uiDir, stateDir, token = secret(), native = () => {}, restoreSessions = false, mcpOptions, mobileOptions, capabilityOptions, newsOptions, voiceOptions = {}, setupOptions = {} }) {
  repo = await realpath(repo);
  stateDir ||= path.join(repo, '.jupiter');
  const dictation = mobileOptions?.dictation || new MobileDictation(repo);
  const files = new Files(repo);
  const attachments = new Attachments(repo);
  const library = new ContextLibrary(repo);
  const knowledgeSources = await readJson(path.join(stateDir, 'knowledge-sources.json'), []);
  const knowledgeProviders = (Array.isArray(knowledgeSources) ? knowledgeSources : []).filter(item => typeof item?.root === 'string').map(item => new MarkdownKnowledgeProvider(item.root, { id: item.id, label: item.label }));
  const knowledge = new KnowledgeManager(library, knowledgeProviders);
  const projects = new ProjectAdapterRegistry();
  const integrations = await new IntegrationManager(stateDir).init();
  const mcp = new McpInventory(repo, mcpOptions);
  const sessions = await new Sessions(repo, stateDir).init();
  const transcripts = new ConversationTranscripts();
  const conversationMedia = new ConversationMedia();
  const readAloud = mobileOptions?.readAloud || new LocalReadAloud(repo);
  const environment = parseEnv(await readFile(path.join(repo, '.env'), 'utf8').catch(() => ''));
  const settingsPath = path.join(stateDir, 'settings.json');
  const savedSettings = await readJson(settingsPath, null);
  let settings = { defaultAgent: 'codex', defaultBypass: false, coordinatorModel: environment.JUPITER_COORDINATOR_MODEL?.trim() || null, terminalFontSize: 13, terminalAppearance: 'original', workspaceTheme: 'jupiter', chatTheme: 'jupiter', coordinatorEffort: 'medium', voiceName: 'marin', voiceStyle: defaultVoiceStyle, handoffAfter: 40, groupTabsByProject: false, systemEvents: 'compact', ...savedSettings };
  if (await dictation.initializeProvider?.(settings, savedSettings !== null)) await saveJson(settingsPath, settings);
  dictation.providerChoice = () => settings.transcribeProvider || null;
  const chooseDictation = async provider => {
    if (!['local', 'openai', 'openrouter', 'off'].includes(provider)) throw Object.assign(new Error('Choose a supported speech-to-text provider.'), { status: 400 });
    settings.transcribeProvider = provider; await saveSettings();
    const info = await dictation.status();
    broadcast('settings', { settings }); broadcast('dictation', { dictation: info });
    mobile?.broadcast({ type: 'dictation', dictation: info });
    return info;
  };
  const projectList = () => recentProjects({ repo, sessions: sessions.list(), pinned: settings.pinnedProjects || [] });
  const projectsRoot = () => settings.projectsDir || path.join(repo, 'projects');
  const connections = new ConnectionsOverview({ repo, projects: projectList, workspaceInventory: mcp, mcpOptions });
  const capabilities = new Capabilities({ repo, stateDir, connections, projects: projectList, ...capabilityOptions });
  // A tool's own editor (Pixelbolt's studio), started from its card and stopped when Jupiter closes.
  const editors = capabilityOptions?.editors || new ToolEditors({ toolsDir: capabilities.toolsDir, cwd: projectsRoot() });
  const nativeWindows = capabilityOptions?.nativeWindows ?? Boolean(process.env.JUPITER_PARENT_PID);
  const withEditors = list => ({ ...list, items: list.items.map(item => item.editor ? { ...item, editorState: editors.state(item.id) } : item) });
  let selectedId = sessions.active().some(item => item.id === settings.selectedId) ? settings.selectedId : sessions.active()[0]?.id || null;
  let workspaceRoute = settings.workspaceRoute || null;
  let settingsTimer;
  let settingsSave = Promise.resolve();
  const saveSettings = () => { settingsSave = settingsSave.catch(() => {}).then(() => saveJson(settingsPath, settings)); return settingsSave; };
  const scheduleSettings = () => { clearTimeout(settingsTimer); settingsTimer = setTimeout(() => saveSettings().catch(() => {}), 500); };
  const transcriptPath = path.join(stateDir, 'voice-transcripts.json');
  let voiceHistory = await readJson(transcriptPath, []);
  let transcriptSave = Promise.resolve();
  let voiceOwner = null;
  let starterRunning = false;
  let closing = false;
  const clients = new Set();
  let mobile;
  const notices = [];
  const send = (ws, type, value) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type, ...value })); };
  const broadcast = (type, value) => { for (const ws of clients) send(ws, type, value); };
  const nativeSettings = new NativeSettings(native, value => broadcast('native-settings', value));
  const show = (window, extra = {}) => { native({ type: 'window', action: 'show', window }); broadcast('navigate', { window, ...extra }); };
  const focus = id => { sessions.get(id); selectedId = id; settings.selectedId = id; scheduleSettings(); show('chats', { sessionId: id }); return { selectedId: id }; };
  const registry = async () => readJson(path.join(repo, 'workspace', 'workspace.json'), { entities: [] });
  const workspace = new Workspace(repo, () => broadcast('workspace-changed', {}));
  const cards = new CardDocuments(workspace);
  const jupiterHome = createJupiterHome(repo);
  const workItems = createWorkItems(repo);
  // Ticket requests: one ticket on the right board, with a visible Codex (or Claude) chat drafting its details.
  const tickets = createTickets({
    workItems,
    shown: slug => { show('workspace', {}); broadcast('show-work', { slug }); },
    openChat: async ({ agent, name, brief }) => sessions.create({ agent, name, effort: 'medium', initialPrompt: await briefFile(brief), bypass: settings.defaultBypass === true }),
  });
  const boards = createBoards(repo);
  let currentBoard = null; // the board Jupiter last opened or changed, for "add a card" follow ups
  const tokenUsage = createTokenUsage(mcpOptions || {});
  const news = createNews(repo, newsOptions || {});
  const weather = createWeather(voiceOptions.weather || {});
  const history = query => sessions.list().filter(item => !query || `${item.name} ${item.agent} ${item.cwd} ${item.preview || ''}`.normalize('NFC').toLowerCase().includes(query.normalize('NFC').toLowerCase())).sort((a, b) => Number(b.pinned) - Number(a.pinned) || String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const closeChat = async id => {
    await sessions.remove(id);
    if (selectedId === id) { selectedId = sessions.active()[0]?.id || null; settings.selectedId = selectedId; scheduleSettings(); broadcast('selection', { selectedId }); }
    return { closed: true, savedInHistory: true };
  };
  const handoffs = new Handoffs({ repo, sessions, transcripts, opened: id => focus(id), changed: (id, handoff) => broadcast('handoff', { id, handoff }) });
  const attach = async (id, paths, coordinator = false) => {
    const session = sessions.get(id);
    const verified = await attachments.paths(paths);
    sessions.input(id, attachmentText(verified, session.agent), { coordinator, submit: false });
    return { attached: verified, submitted: false };
  };
  let jupiterChats = null; // set once the coordinator and quick actions have loaded
  const coordinator = await new Coordinator({
    repo, stateDir, orientation: () => library.orientation(), settings: () => settings,
    context: conversation => ({ repo, localDate: localDay(), selectedId, workspaceRoute, chats: sessions.active(), recentNotices: notices.slice(-5), recentRequests: (conversation && jupiterChats?.messages.get(conversation) || [...coordinator.operations.values(), ...quick.operations.values()].sort((a, b) => a.at.localeCompare(b.at))).slice(-6).map(({ text, result, status }) => ({ text, result, status })) }),
    execute: async (name, args, operationId, requestText) => {
      const latestRequest = requestText || coordinator.operations.get(operationId)?.text || '';
      if (['reopen_chat', 'send_to_chat', 'attach_files'].includes(name)) {
        const target = sessions.get(args.id);
        if (target.agent === 'shell') throw new Error('Use the local shell directly. Jupiter can send tasks only to agent chats.');
        if (target.bypass && settings.defaultBypass !== true) throw new Error('This chat uses bypass permissions. Send the task directly, or enable bypass yourself in Settings before using Jupiter to control it.');
      }
      switch (name) {
        case 'list_chats': return sessions.active();
        case 'search_history': return history(args.query || '').slice(0, 70);
        case 'list_projects': { const query = String(args.query || '').toLowerCase(); return (await projectList()).filter(item => `${item.name} ${item.path}`.toLowerCase().includes(query)).slice(0, 40); }
        case 'reopen_chat': { const session = await sessions.resume(args.id); focus(session.id); return session; }
        case 'close_chat': return closeChat(args.id);
        case 'pin_chat': return sessions.pin(args.id, args.pinned);
        case 'open_chat': {
          args = openChatArguments(args);
          if (args.bypass === true && settings.defaultBypass !== true) throw new Error('To enable bypass, choose it yourself in New chat or Settings. Jupiter cannot raise the selected permission level.');
          const session = await sessions.create({ agent: args.agent, cwd: args.cwd, name: taskTitle(args.name), effort: taskEffort(latestRequest, args.effort), bypass: args.bypass === false ? false : settings.defaultBypass === true });
          focus(session.id); return session;
        }
        case 'read_chat': return sessions.read(args.id);
        case 'send_to_chat': return sessions.input(args.id, args.text, { coordinator: true, submit: true });
        case 'attach_files': return attach(args.id, args.paths, true);
        case 'focus_chat': return focus(args.id);
        case 'rename_chat': return sessions.rename(args.id, args.name);
        case 'interrupt_chat': sessions.input(args.id, '\x03'); return { delivered: 'Ctrl+C', sessionId: args.id };
        case 'list_workspace': return workspace.list(args);
        case 'read_workspace': return workspace.read(args.entityId, args.step);
        case 'workspace_activity': return workspace.activity(args.date);
        case 'update_workspace': return workspace.update(args.entityId, args);
        case 'show_workspace': {
          if (args.entityId && !(await registry()).entities.some(item => item.id === args.entityId)) throw new Error(`No Workspace card has the ID "${args.entityId}". It may have been removed.`);
          workspaceRoute = args.entityId ? `#/${encodeURIComponent(args.entityId)}${Number.isInteger(args.step) ? '/' + args.step : ''}` : null;
          settings.workspaceRoute = workspaceRoute; scheduleSettings();
          // Delivered means a Workspace window that is open in the app was told to show it. Zero means the
          // route is saved and will apply the next time the Workspace opens, but nothing was shown yet.
          const delivered = [...clients].filter(ws => ws.surface === 'workspace').length;
          show('workspace', { route: workspaceRoute }); return { shown: delivered > 0, delivered, route: workspaceRoute };
        }
        case 'preview_file': { const preview = await files.preview(args.path); show('workspace', { preview }); return { shown: preview.path }; }
        case 'list_files': return files.list(args.path || repo, 'all', args.query || '');
        case 'search_context': return knowledge.searchText(args.query);
        case 'read_context': return knowledge.read(args.path, args.offset);
        case 'list_skills': return knowledge.skills(args.query || '');
        case 'list_mcp': return mcp.list();
        case 'show_view': {
          const views = { home: 'home', todo: 'todo', news: 'news', notes: 'notes', projects: 'projects', tokens: 'tokens', plugins: 'plugins', connections: 'connections', archive: 'archive', agents: 'agents', settings: 'settings', files: 'files' };
          if (!views[args.view]) throw new Error('Choose a view Jupiter has.');
          show('workspace', {}); broadcast('show-view', { view: args.view }); return { shown: args.view };
        }
        case 'list_boards': return (await boards.list()).map(board => ({ title: board.title, slug: board.slug, cards: board.count }));
        case 'open_board': { const board = await boards.ensure(args.title); currentBoard = board.slug; show('workspace', {}); broadcast('show-board', { slug: board.slug }); return { opened: board.title, cards: board.items.length }; }
        case 'add_to_board': {
          const slug = args.title ? (await boards.ensure(args.title)).slug : currentBoard || (await boards.list())[0]?.slug || (await boards.ensure('Brainstorm')).slug;
          const board = await boards.add(slug, { notes: Array.isArray(args.notes) ? args.notes.slice(0, 50) : [], links: Array.isArray(args.links) ? args.links.slice(0, 50) : [] });
          currentBoard = board.slug; broadcast('show-board', { slug: board.slug, changed: true });
          return { board: board.title, cards: board.items.filter(item => item.type === 'note').map(item => item.text), connections: board.links.length };
        }
        case 'add_work_item': return tickets.add(args, { request: latestRequest });
        case 'start_work_chat': {
          const wanted = String(args.title || '').trim().toLowerCase();
          let found = null;
          for (const row of await workItems.list()) { const board = await workItems.read(row.slug); const item = board.items.find(entry => entry.title.toLowerCase() === wanted) || board.items.find(entry => entry.title.toLowerCase().includes(wanted)); if (item) { found = { board, item }; break; } }
          if (!found) throw new Error('No work item has that title.');
          const { board, item } = found;
          const kind = { feature: 'feature', bug: 'bug', spike: 'spike (research)' }[item.type] || 'feature';
          // Only an explicit goal does anything: shape fills in the ticket, build does the work. With no goal
          // the chat just reads the ticket and waits, so opening a conversation never starts work by accident.
          const shape = args.goal === 'shape', build = args.goal === 'build';
          const brief = [`This is a ${kind} from my Jupiter work board "${board.title}" (file: knowledge/work/${board.slug}.json, item id ${item.id}).${shape || build ? '' : ' It is context for our conversation, not a request to do anything yet.'}`, '', `# ${item.title}`, '',
            item.details.trim() ? `## Details\n\n${item.details.trim()}\n` : '## Details\n\n(none yet)\n',
            item.acceptance.trim() ? `## Acceptance criteria\n\n${item.acceptance.trim()}\n` : '## Acceptance criteria\n\n(none yet)\n',
            item.tasks.length ? `## Tasks\n\n${item.tasks.map(task => `- [${task.done ? 'x' : ' '}] ${task.title}`).join('\n')}\n` : '',
            shape ? 'Please shape this item: write clear details, testable acceptance criteria and a short list of tasks. Then write them into that item in the board file (fields "details", "acceptance" and "tasks" as { "title", "done": false }), keeping the JSON valid and every other item unchanged.'
              : build ? `Please work on this ${kind}. Check your plan against the acceptance criteria (write them into the board file first if there are none), and when you finish tell me which criteria are met and which tasks are done.`
                : 'Please read the ticket above, reply with a short acknowledgement of one or two sentences saying what it is about, then wait for me to tell you what to do next. Do not start work, investigate, research, fix or implement anything, and do not change the ticket, its tasks, its acceptance checkboxes or any files until I ask. Unchecked acceptance criteria and tasks are context, not instructions. If I ask you to add details, refine the ticket, plan it or start on it, do that then.'].join('\n');
          const session = await sessions.create({ agent: args.agent === 'codex' ? 'codex' : 'claude', cwd: typeof args.cwd === 'string' && args.cwd ? args.cwd : undefined, name: item.title.slice(0, 60), initialPrompt: await briefFile(brief), bypass: settings.defaultBypass });
          focus(session.id);
          if (item.state === 'todo' && build) { item.state = 'doing'; item.updated = new Date().toISOString(); await workItems.save(board.slug, board); broadcast('show-work', { slug: board.slug }); }
          return { chat: session.name, agent: session.agent, item: item.title };
        }
        case 'get_weather': return { say: await weather.describe(`${args.when === 'tomorrow' ? 'tomorrow ' : ''}${args.place ? `in ${args.place}` : ''}`, settings.weatherPlace || 'London') };
        case 'get_news': return { say: (await describeNews(news, String(args.topic || ''))).text };
        case 'map_project': {
          const project = await findProject(repo, String(args.name || ''), projectsRoot());
          if (!project) throw new Error(`There is no folder called ${args.name} in projects.`);
          return await mapProject(project, args.update === true);
        }
        case 'get_app_settings': return { voice: settings.voiceName, style: settings.voiceStyle, model: coordinator.model || 'Codex default', effort: settings.coordinatorEffort, billing: 'Codex subscription for the coordinator; OpenAI API for voice' };
        case 'update_voice': {
          if (typeof args.style === 'string' && args.style.trim()) settings.voiceStyle = args.style.trim().slice(0, 1800);
          if (['cedar', 'marin'].includes(args.voice)) settings.voiceName = args.voice;
          await saveSettings(); broadcast('settings', { settings });
          return { saved: true, voice: settings.voiceName, style: settings.voiceStyle, applies: 'Next voice connection. Reconnect to apply the saved voice and personality.' };
        }
        default: throw new Error('Unknown coordinator tool');
      }
    },
  }).init();
  const quick = await new QuickActions({ stateDir, workspace, context: () => ({ chats: sessions.active(), route: workspaceRoute }), execute: (...args) => coordinator.execute(...args), completed: operation => { broadcast('coordinator-result', { operation }); recordResult(operation); } }).init();
  // Jupiter's own conversations. Earlier requests become one "Earlier conversation" the first time.
  jupiterChats = await new JupiterChats(stateDir).init([...coordinator.operations.values(), ...quick.operations.values()].sort((a, b) => a.at.localeCompare(b.at)));
  const chatsChanged = () => broadcast('jupiter-chats', { chats: jupiterChats.summary() });
  const recordResult = operation => { void jupiterChats.record(operation).then(chat => { if (chat) chatsChanged(); }).catch(() => {}); };
  const askJupiter = async incoming => {
    // A request belongs to the conversation it was sent from, or the active one (voice).
    const data = { ...incoming, conversationId: jupiterChats.find(incoming.conversationId) ? incoming.conversationId : jupiterChats.active };
    await jupiterChats.read(data.conversationId).catch(() => {});
    if (coordinator.operationPromises.has(data.id) || coordinator.operations.has(data.id)) return coordinator.ask(data);
    const images = await attachments.coordinatorImages(data.images);
    if (images.length) return coordinator.ask({ ...data, images });
    return await quick.ask(data) || coordinator.ask({ ...data, images });
  };
  // A first message travels on the agent's command line, which takes one plain line. A longer
  // brief (several lines, quotes, Markdown) is saved in inbox/briefs and the chat is told to read it.
  const briefFile = async prompt => {
    if (typeof prompt !== 'string' || !prompt.trim()) return prompt;
    const plain = prompt.length <= 3000 && !/[\x00-\x1f\x7f"]/.test(prompt) && !/^\s*-/.test(prompt);
    if (plain) return prompt;
    if (prompt.length > 200000) throw Object.assign(new Error('That brief is too long.'), { status: 400 });
    const folder = path.join(repo, 'inbox', 'briefs');
    await mkdir(folder, { recursive: true });
    const name = `${new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)}-${randomUUID().slice(0, 6)}.md`;
    await writeFile(path.join(folder, name), prompt.endsWith('\n') ? prompt : `${prompt}\n`);
    return `Read the brief in inbox/briefs/${name} and do what it asks.`;
  };
  coordinator.on('state', state => broadcast('coordinator-state', { state }));

  // Hey Jupiter: the offline listener hears the wake word, the assistant answers, ElevenLabs speaks.
  const voiceOut = voiceOptions.voiceOut || createVoiceOut(repo);
  const wake = voiceOptions.wake || new WakeWord(repo, { env: environment });
  const spoken = new Map(); // short lived audio for replies too long to keep
  const voiceClip = (result, text = '') => {
    if (result.audio) { const id = randomUUID(); spoken.set(id, result.audio); setTimeout(() => spoken.delete(id), 5 * 60 * 1000).unref?.(); return { url: `/api/voice/audio/${id}`, text }; }
    return { url: `/api/voice/clip/${encodeURIComponent(path.basename(result.file))}`, text, cached: result.cached };
  };
  let conversing = false, lastSaid = null;
  const FOLLOW_UP_SECONDS = 10;
  const SIGN_OFF = /\b(thanks?|thank you|cheers)\b.*\b(jupiter|take it from here|that'?s (all|it)|done)\b|\b(i'?ll take it from here|that'?s (all|it)( for now)?|stop listening|go to sleep|goodbye|bye( jupiter)?|never ?mind|that'?ll be all)\b/i;
  const say = async (kind, text) => {
    lastSaid = kind;
    try {
      const result = text ? await voiceOut.speak(text) : await voiceOut.phrase(kind);
      wake.mute(true);
      broadcast('voice-say', { kind, ...voiceClip(result, result.text || '') });
    } catch (error) { broadcast('voice-say', { kind, url: null, text: text || '', error: publicError(error) }); }
  };
  wake.on('state', state => broadcast('wake-state', { state }));
  wake.on('wake', () => { conversing = true; broadcast('wake-heard', {}); void say('wake'); });
  wake.on('timeout', () => { conversing = false; broadcast('wake-idle', {}); });
  // "Open my to do list", "show the news", "close that": the screen handles it, like Siri.
  const NAVIGATE = /^(?:(?:can|could) you |please |jupiter,? )?(?:open|show|close|hide|go (?:to|back|home)|take me|bring up|pull up|switch to|back|home|dismiss|let'?s brainstorm|what'?s connected|what can you show)\b/i;
  // Project maps: a visible Claude Code chat runs graphify in projects/<name> and writes PROJECT_MAP.md
  // there. While it works the brain shows signals hopping node to node; when it finishes Jupiter says so.
  const mapping = new Map();
  const mapProject = async (project, update) => {
    const session = await sessions.create({ agent: 'claude', cwd: project.path, name: `${update ? 'Refresh map' : 'Map'} ${project.name}`.slice(0, 60), initialPrompt: await briefFile(await scanBrief(repo, project, { update })), readDir: path.join(repo, 'knowledge'), bypass: settings.defaultBypass === true });
    mapping.set(session.id, { name: project.name, update, seen: 0 });
    broadcast('jupiter-reading', { on: true, label: `${update ? 'Rereading' : 'Mapping'} ${project.name}` });
    return { chat: session.name, folder: project.path, file: path.join(project.path, 'PROJECT_MAP.md'), update };
  };
  sessions.on('session', session => {
    const job = mapping.get(session.id);
    if (!job) return;
    if (session.activity === 'working') job.seen = 1;
    const finished = session.status === 'exited' || (job.seen && session.activity === 'idle' && session.completionVersion > 0);
    if (!finished) return;
    mapping.delete(session.id);
    if (!mapping.size) broadcast('jupiter-reading', { on: false });
    void say('reply', session.status === 'exited' && !job.seen ? `The ${job.name} map stopped before it started, boss.` : `${job.update ? 'The map of' : 'Your map of'} ${job.name} is ${job.update ? 'up to date' : 'ready'}, boss. It's in PROJECT_MAP.md in the folder.`);
  });
  let offer = null;
  let newsOpens = 0;
  const YES = /^(?:yes|yeah|yep|sure|go on|please|ok(?:ay)?|open it|do it|show me)\b/i;
  // Weather, news, project maps and "yes, open it": answered here, straight away.
  const quickAnswer = async text => {
    if (offer && Date.now() - offer.at < 30000 && YES.test(text.trim()) && text.length < 40) {
      const view = offer.view; offer = null;
      broadcast('show-view', { view }); void say('opening'); return true;
    }
    offer = null;
    if (parseTicketRequest(text)) return false; // a ticket about the news or the weather is still a ticket
    const scan = await matchProjectScan(repo, text, projectsRoot()).catch(() => null);
    if (scan) {
      try { await mapProject(scan.project, scan.update); await say('reply', scan.update ? `On it. Rereading ${scan.project.name} and updating its map.` : `On it. Mapping ${scan.project.name} now, I'll tell you when it's done.`); }
      catch (error) { await say('reply', `I couldn't start the map: ${publicError(error)}`); }
      return true;
    }
    if (WEATHER_ASK.test(text) && text.length < 140) {
      broadcast('jupiter-reading', { on: true, label: 'Checking the weather', brief: true });
      try { await say('reply', await weather.describe(text, settings.weatherPlace || 'London')); }
      catch { await say('reply', "I can't reach the weather service right now, boss."); }
      return true;
    }
    if (NEWS_ASK.test(text) && text.length < 140 && !NAVIGATE.test(text) && !/\b(add|note|board|card|write|save)\b/i.test(text)) {
      broadcast('jupiter-reading', { on: true, label: 'Reading the news', brief: true });
      try { const result = await describeNews(news, text); offer = { at: Date.now(), view: 'news' }; await say('reply', result.text); }
      catch { await say('reply', "I can't reach the news right now."); }
      return true;
    }
    return false;
  };
  const answer = async text => {
    if (await quickAnswer(text)) return;
    void say('working');
    try {
      const operation = await askJupiter({ id: randomUUID(), text, images: [], selectedId });
      const reply = operation?.status === 'completed' ? String(operation.result || '').trim() : '';
      if (reply) await say('reply', reply); else await say(operation?.status === 'completed' ? 'done' : 'failed');
    } catch { await say('failed'); }
  };
  wake.on('command', async text => {
    if (SIGN_OFF.test(text) && text.length < 80) { conversing = false; broadcast('wake-command', { text }); void say('bye'); return; }
    conversing = true;
    broadcast('wake-command', { text });
    if (await quickAnswer(text)) return;
    if (NAVIGATE.test(text) && text.length < 90 && !parseTicketRequest(text)) { broadcast('jupiter-navigate', { text, voice: true }); return; }
    void say('working');
    try {
      const operation = await askJupiter({ id: randomUUID(), text, images: [], selectedId });
      const answer = operation?.status === 'completed' ? String(operation.result || '').trim() : '';
      if (answer) await say('reply', answer); else await say(operation?.status === 'completed' ? 'done' : 'failed');
    } catch { await say('failed'); }
  });
  const wakeWanted = () => settings.wakeWord !== false;
  if (voiceOptions.listen && wakeWanted()) void wake.start();
  coordinator.on('result', operation => { broadcast('coordinator-result', { operation }); recordResult(operation); });
  coordinator.on('error-detail', error => broadcast('service-error', { error }));
  sessions.on('session', session => { broadcast('session', { session }); integrations.publish('session', { event: session.status, session }).catch(() => {}); });
  // A ticket's drafting chat has finished: say whether the details really reached the board.
  sessions.on('session', session => { void tickets.observe(session).then(result => { if (!result) return; if (result.ok) broadcast('show-work', { slug: result.slug }); return say('reply', result.text); }).catch(() => {}); });
  sessions.on('screen-cleared', ({ id }) => broadcast('screen-cleared', { id }));
  sessions.on('removed', ({ id }) => broadcast('removed', { id }));
  sessions.on('service-error', error => broadcast('service-error', { error: publicError(error) }));
  sessions.on('output', output => {
    for (const ws of clients) {
      if (ws.sessionId !== output.id) continue;
      if (ws.bufferedAmount > 2 * 1024 * 1024) { ws.close(1013, 'Reconnect to restore the terminal screen'); continue; }
      send(ws, 'output', output);
    }
  });
  sessions.on('notice', notice => { notices.push(notice); if (notices.length > 100) notices.shift(); broadcast('notice', { notice }); if (notice.kind === 'turn-completed' || notice.kind === 'exit') integrations.publish('completion', notice).catch(() => {}); });

  const contentServer = http.createServer(async (request, response) => {
    try {
      if (request.headers.host !== new URL(files.origin).host || !['GET', 'HEAD'].includes(request.method)) throw Object.assign(new Error('Not allowed'), { status: 403 });
      await files.content(request, response, new URL(request.url, files.origin));
    } catch (error) { if (!response.headersSent) json(response, error.status || 404, { error: publicError(error) }); }
  });
  files.origin = await listen(contentServer);

  function authorize(request) {
    if (request.headers.host !== new URL(origin).host) throw Object.assign(new Error('Unexpected host'), { status: 403 });
    if (request.headers.origin && request.headers.origin !== origin) throw Object.assign(new Error('Unexpected origin'), { status: 403 });
    if (!equalSecret(request.headers.authorization, `Bearer ${token}`)) throw Object.assign(new Error('Open Jupiter from its desktop launcher'), { status: 401 });
  }
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, origin);
      if (request.headers.host !== new URL(origin).host) throw Object.assign(new Error('Unexpected host'), { status: 403 });
      if (url.pathname === '/health') return json(response, 200, { service: 'jupiter', version: '0.6.0' });
      // An <img> cannot send the bearer token. Its unguessable, short-lived grant
      // is issued only through an authorized messages request for this chat.
      const media = /^\/media\/([a-f0-9-]{36})\/([a-zA-Z0-9_-]{43})$/.exec(url.pathname);
      if (media && ['GET', 'HEAD'].includes(request.method)) return await conversationMedia.serve(request, response, media[1], media[2], 'desktop', url.searchParams.get('download') === '1');
      if (url.pathname.startsWith('/api/')) {
        authorize(request);
        const method = request.method;
        const cardImage = /^\/api\/workspace\/cards\/([^/]+)\/(\d+)\/images$/.exec(url.pathname);
        if (method === 'POST' && cardImage) return json(response, 201, await cards.image(decodeURIComponent(cardImage[1]), Number(cardImage[2]), request, url.searchParams.get('name')));
        if (method === 'POST' && url.pathname === '/api/files/import') {
          if (Number(request.headers['content-length']) > MAX_FILE_BYTES) throw Object.assign(new Error('Choose files of 1 GB or less.'), { status: 413 });
          const result = await importFile(request, url.searchParams.get('folder'), url.searchParams.get('name'));
          await integrations.publish('artifact', { kind: 'imported', ...result });
          broadcast('workspace-changed', {});
          return json(response, 201, result);
        }
        if (method === 'POST' && url.pathname === '/api/attachments') {
          const chunks = []; let length = 0;
          for await (const chunk of request) { length += chunk.length; if (length > MAX_IMAGE_BYTES) throw Object.assign(new Error('Choose an image smaller than 25 MB.'), { status: 413 }); chunks.push(chunk); }
          return json(response, 201, await attachments.save(Buffer.concat(chunks), decodeURIComponent(request.headers['x-file-name'] || 'Screenshot')));
        }
        if (method === 'GET' && url.pathname === '/api/dictation') return json(response, 200, await dictation.status());
        if (method === 'POST' && url.pathname === '/api/transcribe') return json(response, 200, await dictation.transcribe(request, 'desktop', () => !closing));
        const data = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method) ? await body(request, url.pathname === '/api/files/markdown' ? 12 * 1024 * 1024 : url.pathname.startsWith('/api/workspace/cards') || url.pathname.startsWith('/api/work/') ? 2 * 1024 * 1024 : 256 * 1024) : {};
        if (method === 'POST' && url.pathname === '/api/dictation') return json(response, 200, await chooseDictation(data.provider));
        if (method === 'GET' && url.pathname === '/api/mobile') return json(response, 200, mobile.status());
        if (method === 'GET' && url.pathname === '/api/mobile/check') return json(response, 200, await mobile.transport.probe());
        if (method === 'POST' && url.pathname === '/api/mobile/enable') return json(response, 200, await mobile.enable());
        if (method === 'POST' && url.pathname === '/api/mobile/disable') return json(response, 200, await mobile.disable());
        if (method === 'POST' && url.pathname === '/api/mobile/pair') return json(response, 200, await mobile.newPairing());
        if (method === 'POST' && url.pathname === '/api/mobile/approve') return json(response, 200, await mobile.approve(data.id));
        if (method === 'POST' && url.pathname === '/api/mobile/revoke') return json(response, 200, await mobile.revoke(data.id));
        if (method === 'GET' && url.pathname === '/api/bootstrap') {
          const keys = parseEnv(await readFile(path.join(repo, '.env'), 'utf8').catch(() => ''));
          return json(response, 200, { repo, contentBase: `${files.origin}/view/${files.repoGrant}`, agents: inventory(), sessions: sessions.list(), settings, selectedId, notices, coordinator: coordinator.state, voice: { configured: !!(keys.OPENAI_API_KEY || keys.OPENAI_KEY || process.env.OPENAI_API_KEY), owner: voiceOwner }, voiceHistory, operations: [...coordinator.operations.values(), ...quick.operations.values()].sort((a, b) => a.at.localeCompare(b.at)).slice(-30), jupiterChats: jupiterChats.summary() });
        }
        // Jupiter's own conversations (the Activity tab).
        if (method === 'GET' && url.pathname === '/api/jupiter/chats') return json(response, 200, jupiterChats.summary());
        const chatMessages = /^\/api\/jupiter\/chats\/([a-z0-9-]{6,64})\/messages$/.exec(url.pathname);
        if (method === 'GET' && chatMessages) return json(response, 200, { messages: await jupiterChats.read(chatMessages[1]) });
        if (method === 'POST' && url.pathname.startsWith('/api/jupiter/chats/')) {
          const action = url.pathname.slice('/api/jupiter/chats/'.length);
          if (action === 'new') await jupiterChats.create();
          else if (action === 'select') await jupiterChats.select(String(data.id || ''));
          else if (action === 'rename') await jupiterChats.rename(String(data.id || ''), data.title);
          else if (action === 'delete') { const id = String(data.id || ''); await jupiterChats.remove(id); coordinator.forget(id); }
          else return json(response, 404, { error: 'Unknown conversation action.' });
          chatsChanged();
          return json(response, 200, jupiterChats.summary());
        }
        if (method === 'GET' && url.pathname === '/api/workspace') return json(response, 200, await registry());
        if (method === 'GET' && url.pathname === '/api/jupiter/home') return json(response, 200, await jupiterHome.read());
        if (method === 'POST' && url.pathname === '/api/jupiter/home') return json(response, 200, await jupiterHome.update(data));
        if (method === 'GET' && url.pathname === '/api/work/boards') return json(response, 200, await workItems.list());
        if (method === 'POST' && url.pathname === '/api/work/boards') return json(response, 201, await workItems.create(data));
        if (method === 'POST' && url.pathname === '/api/work/quick') return json(response, 200, await workItems.quick(data.title));
        const workBoard = /^\/api\/work\/boards\/([^/]+)$/.exec(url.pathname);
        if (workBoard && method === 'GET') return json(response, 200, await workItems.read(decodeURIComponent(workBoard[1])));
        if (workBoard && method === 'PUT') return json(response, 200, await workItems.save(decodeURIComponent(workBoard[1]), data.board));
        if (workBoard && method === 'DELETE') return json(response, 200, await workItems.remove(decodeURIComponent(workBoard[1])));
        const workWeekly = /^\/api\/work\/boards\/([^/]+)\/weekly$/.exec(url.pathname);
        if (workWeekly && method === 'GET') return json(response, 200, await workItems.weekly(decodeURIComponent(workWeekly[1]), Number(url.searchParams.get('offsetWeeks') || 0)));
        if (workWeekly && method === 'POST') return json(response, 200, { path: (await workItems.saveWeekly(decodeURIComponent(workWeekly[1]), Number(data.offsetWeeks || 0))).path });
        const workRestore = /^\/api\/work\/boards\/([^/]+)\/restore$/.exec(url.pathname);
        if (workRestore && method === 'POST') return json(response, 200, await workItems.restore(decodeURIComponent(workRestore[1]), data.name));
        if (method === 'GET' && url.pathname === '/api/boards') return json(response, 200, await boards.list());
        if (method === 'GET' && url.pathname === '/api/tokens') return json(response, 200, await tokenUsage.summary());
        if (method === 'GET' && url.pathname === '/api/news') return json(response, 200, await news.topic(url.searchParams.get('topic') || 'ai', { force: url.searchParams.get('refresh') === '1' }));
        if (method === 'GET' && url.pathname === '/api/news/overview') return json(response, 200, await news.overview());
        if (method === 'POST' && url.pathname === '/api/boards/quick') return json(response, 200, await boards.quick(data.text));
        if (method === 'POST' && url.pathname === '/api/boards') return json(response, 201, await boards.save(null, data));
        const boardRoute = /^\/api\/boards\/([^/]+)$/.exec(url.pathname);
        if (boardRoute && method === 'GET') return json(response, 200, await boards.read(decodeURIComponent(boardRoute[1])));
        if (boardRoute && method === 'PUT') return json(response, 200, await boards.save(decodeURIComponent(boardRoute[1]), data));
        if (boardRoute && method === 'DELETE') return json(response, 200, await boards.remove(decodeURIComponent(boardRoute[1])));
        if (method === 'POST' && url.pathname === '/api/workspace/cards') return json(response, 201, await cards.create(data));
        const cardDocument = /^\/api\/workspace\/cards\/([^/]+)\/(\d+)$/.exec(url.pathname);
        if (cardDocument && method === 'GET') return json(response, 200, await cards.read(decodeURIComponent(cardDocument[1]), Number(cardDocument[2])));
        if (cardDocument && method === 'PUT') return json(response, 200, await cards.save(decodeURIComponent(cardDocument[1]), Number(cardDocument[2]), data));
        const cardMetadata = url.pathname.match(/^\/api\/workspace\/entities\/([^/]+)$/);
        if (method === 'PATCH' && cardMetadata) return json(response, 200, await workspace.update(decodeURIComponent(cardMetadata[1]), metadataPatch(data)));
        if (method === 'DELETE' && cardMetadata) {
          const removed = await workspace.remove(decodeURIComponent(cardMetadata[1]));
          // The card's folder goes to the Recycle Bin through the desktop shell, so it can be restored.
          if (removed.folder) native({ type: 'recycle-file', path: removed.folder });
          broadcast('workspace-changed', {});
          return json(response, 200, removed);
        }
        // "Edit page" opens a visible Claude Code chat that changes one page of this card.
        const pageEdit = /^\/api\/workspace\/entities\/([^/]+)\/edit-page$/.exec(url.pathname);
        if (method === 'POST' && pageEdit) {
          const page = await workspace.editPage(decodeURIComponent(pageEdit[1]), data, changed => broadcast('workspace-changed', { path: changed }));
          const session = await sessions.create({ agent: 'claude', cwd: repo, name: page.name, initialPrompt: await briefFile(page.brief), bypass: settings.defaultBypass });
          focus(session.id);
          return json(response, 201, { sessionId: session.id, chat: session.name, path: page.relative });
        }
        if (method === 'GET' && url.pathname === '/api/projects') {
          const matches = await projects.detect(url.searchParams.get('path') || repo);
          return json(response, 200, { matches, adapters: projects.adapters.map(item => ({ id: item.id, label: item.label })) });
        }
        if (method === 'GET' && url.pathname === '/api/projects/capabilities') {
          const matches = await projects.detect(url.searchParams.get('path') || repo);
          const selected = matches.find(item => item.adapterId === (url.searchParams.get('adapter') || matches[0]?.adapterId));
          return json(response, 200, selected ? await projects.capabilities(selected) : { matches: [] });
        }
        if (method === 'GET' && url.pathname === '/api/knowledge/providers') return json(response, 200, knowledge.list());
        if (method === 'GET' && url.pathname === '/api/knowledge/search') return json(response, 200, await knowledge.search(url.searchParams.get('q') || '', url.searchParams.get('provider')));
        if (method === 'GET' && url.pathname === '/api/knowledge/document') return json(response, 200, await knowledge.retrieve(url.searchParams.get('provider') || '', url.searchParams.get('ref') || '', url.searchParams.get('offset')));
        if (method === 'GET' && url.pathname === '/api/integrations') return json(response, 200, { providers: integrations.list(), bindings: integrations.bindings.map(({ providerId, externalId, workspaceId, boundAt }) => ({ providerId, externalId, workspaceId, boundAt })) });
        if (method === 'POST' && url.pathname === '/api/integrations/bind') return json(response, 200, await integrations.bind(data));
        if (method === 'GET' && url.pathname === '/api/native/settings') return json(response, 200, nativeSettings.value);
        if (method === 'GET' && url.pathname === '/api/mcp') return json(response, 200, await mcp.list());
        if (method === 'POST' && url.pathname === '/api/mcp/check') return json(response, 200, await mcp.check(data.id));
        if (method === 'GET' && url.pathname === '/api/connections') return json(response, 200, await connections.overview());
        if (method === 'POST' && url.pathname === '/api/connections/check') return json(response, 200, await connections.check(data.project, data.id));
        if (method === 'GET' && url.pathname === '/api/capabilities') return json(response, 200, withEditors(await capabilities.list()));
        if (method === 'POST' && url.pathname === '/api/capabilities/editor') {
          const item = (await capabilities.list()).items.find(entry => entry.id === String(data.id || ''));
          if (!item?.editor || item.state !== 'installed') return json(response, 404, { error: 'Install this tool before opening its editor.' });
          // In the desktop app the editor opens in its own Jupiter window (not a browser); closing that
          // window leaves the editor running, and Stop editor (or quitting Jupiter) ends it.
          if (data.action === 'stop') { native({ type: 'tool-window', id: item.id, action: 'close' }); return json(response, 200, editors.stop(item.id)); }
          const address = await editors.open(item.id, item.editor);
          if (nativeWindows) native({ type: 'tool-window', id: item.id, action: 'open', url: address, title: item.editor.title || `${item.title || item.name} editor` });
          return json(response, 200, { running: true, url: address, window: nativeWindows });
        }
        if (method === 'POST' && url.pathname === '/api/capabilities/review') return json(response, 200, await capabilities.review(String(data.id || ''), data.targets));
        if (method === 'POST' && url.pathname === '/api/capabilities/install') return json(response, 200, await capabilities.install(String(data.id || ''), { token: data.token ? String(data.token) : undefined, targets: data.targets, acceptHooks: data.acceptHooks === true }));
        if (method === 'POST' && url.pathname === '/api/capabilities/check-updates') return json(response, 200, await capabilities.checkUpdates());
        if (method === 'POST' && url.pathname === '/api/capabilities/update') return json(response, 200, await capabilities.update(String(data.id || ''), { acceptHooks: data.acceptHooks === true }));
        if (method === 'POST' && url.pathname === '/api/capabilities/remove') return json(response, 200, await capabilities.remove(String(data.id || ''), { target: data.target ? String(data.target) : undefined }));
        if (method === 'POST' && url.pathname === '/api/native/settings') return json(response, 200, await nativeSettings.set(data.winKey));
        if (method === 'GET' && url.pathname === '/api/recent-projects') return json(response, 200, await projectList());
        if (method === 'POST' && url.pathname === '/api/recent-projects/pin') {
          const project = (await projectList()).find(item => typeof data.path === 'string' && projectKey(item.path) === projectKey(data.path));
          if (!project || typeof data.pinned !== 'boolean') throw new Error('Choose a project from the list.');
          const others = (settings.pinnedProjects || []).filter(item => projectKey(item) !== projectKey(project.path));
          settings.pinnedProjects = data.pinned ? [...others, project.path].slice(-30) : others;
          await saveSettings(); broadcast('settings', { settings });
          return json(response, 200, await projectList());
        }
        if (method === 'GET' && url.pathname === '/api/read-aloud') return json(response, 200, await readAloud.status());
        if (method === 'POST' && url.pathname === '/api/workspace/link') {
          // A link to a Workspace card, clicked in a chat or terminal, opens inside Jupiter. Anything else is left to the browser.
          const link = cardLink(String(data.href || ''), { appOrigin: origin, entities: (await registry()).entities });
          if (link.kind === 'other') return json(response, 200, { handled: false });
          if (link.kind === 'unknown') return json(response, 200, { handled: true, shown: false, error: unknownCardMessage(link.id) });
          const result = await coordinator.execute('show_workspace', link.kind === 'card' ? { entityId: link.id, ...(link.step >= 0 ? { step: link.step } : {}) } : {}, 'card-link', '');
          return json(response, 200, { handled: true, shown: result.shown, route: result.route, ...(link.kind === 'card' ? { title: link.title } : {}), ...(link.note ? { note: link.note } : {}) });
        }
        if (method === 'POST' && url.pathname === '/api/preview/show') {
          // A link in a chat may be relative to that chat's working folder.
          const base = typeof data.sessionId === 'string' ? sessions.get(data.sessionId).cwd : repo;
          if (typeof data.path !== 'string' || !data.path.trim() || /[\x00-\x1f]/.test(data.path)) throw new Error('Choose a local file or folder.');
          const target = await realpath(path.resolve(base, data.path));
          if ((await stat(target)).isDirectory()) { native({ type: 'reveal', path: target }); return json(response, 200, { shown: 'folder', path: target }); }
          const preview = await files.preview(target); show('workspace', { preview });
          return json(response, 200, { shown: 'preview', path: preview.path });
        }
        if (method === 'GET' && url.pathname === '/api/history') return json(response, 200, history(url.searchParams.get('q') || ''));
        if (method === 'POST' && url.pathname === '/api/history/import') return json(response, 201, await sessions.importConversation(data));
        if (method === 'GET' && url.pathname === '/api/files') return json(response, 200, await files.list(url.searchParams.get('path') || repo, url.searchParams.get('mode') || 'main', url.searchParams.get('q') || ''));
        if (method === 'POST' && url.pathname === '/api/files/pick') {
          if (typeof data.requestId !== 'string' || !/^[a-f\d-]{36}$/i.test(data.requestId)) throw new Error('Invalid file picker request.');
          native({ type: 'pick-files', window: 'chats', requestId: data.requestId });
          return json(response, 200, { requested: true });
        }
        if (method === 'POST' && url.pathname === '/api/files/drag') {
          const paths = await dragFiles(data.paths);
          native({ type: 'drag-files', window: 'workspace', paths });
          return json(response, 200, { requested: true });
        }
        if (method === 'POST' && url.pathname === '/api/files/import-path') {
          const source = (await realFile(data.path)).file;
          if (!(await stat(source)).isFile()) throw new Error('Drop individual files to copy them into a folder.');
          return json(response, 200, await importFile(createReadStream(source), data.folder, path.basename(source)));
        }
        if (method === 'POST' && url.pathname === '/api/files/move') {
          const result = await moveFile(data.path, data.folder);
          broadcast('workspace-changed', {});
          return json(response, 200, result);
        }
        if (method === 'POST' && url.pathname === '/api/files/recycle') {
          const file = await recyclePath(data.path, repo);
          native({ type: 'recycle-file', path: file });
          return json(response, 200, { requested: true, path: file });
        }
        if (method === 'GET' && url.pathname === '/api/preview') return json(response, 200, await files.preview(url.searchParams.get('path') || ''));
        if (method === 'POST' && url.pathname === '/api/files/markdown') {
          const preview = await files.saveMarkdown(data); await integrations.publish('artifact', { kind: 'updated', path: preview.path, name: preview.name }); broadcast('workspace-changed', {});
          return json(response, 200, preview);
        }
        if (method === 'POST' && url.pathname === '/api/settings') {
          if (inventory().some(item => item.id === data.defaultAgent)) settings.defaultAgent = data.defaultAgent;
          if (typeof data.defaultBypass === 'boolean') settings.defaultBypass = data.defaultBypass;
          if (Number.isInteger(data.terminalFontSize) && data.terminalFontSize >= 10 && data.terminalFontSize <= 24) settings.terminalFontSize = data.terminalFontSize;
          if (['focus', 'original'].includes(data.terminalAppearance)) settings.terminalAppearance = data.terminalAppearance;
          if (typeof data.terminalOptionMeta === 'boolean') settings.terminalOptionMeta = data.terminalOptionMeta;
          if (Number.isInteger(data.handoffAfter) && (data.handoffAfter === 0 || (data.handoffAfter >= 10 && data.handoffAfter <= 500))) settings.handoffAfter = data.handoffAfter;
          if (['full', 'compact', 'hidden'].includes(data.systemEvents)) settings.systemEvents = data.systemEvents;
          if (isThemePreference(data.workspaceTheme)) settings.workspaceTheme = data.workspaceTheme;
          if (isThemePreference(data.chatTheme)) settings.chatTheme = data.chatTheme;
          if (['medium', 'high'].includes(data.coordinatorEffort)) settings.coordinatorEffort = data.coordinatorEffort;
          if (['cedar', 'marin'].includes(data.voiceName)) settings.voiceName = data.voiceName;
          if (data.groupColors && typeof data.groupColors === 'object' && !Array.isArray(data.groupColors)) settings.groupColors = Object.fromEntries(Object.entries(data.groupColors).filter(([name, value]) => name.length <= 60 && typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)).slice(0, 200).map(([name, value]) => [name, value.toLowerCase()]));
          if (Array.isArray(data.collapsedGroups)) settings.collapsedGroups = [...new Set(data.collapsedGroups.filter(item => typeof item === 'string' && item.length <= 60))].slice(0, 200);
          await saveSettings(); broadcast('settings', { settings }); return json(response, 200, settings);
        }
        if (method === 'POST' && url.pathname === '/api/sessions') { const session = await sessions.create({ ...data, initialPrompt: await briefFile(data.initialPrompt), bypass: data.bypass ?? settings.defaultBypass }); await integrations.publish('session', { event: 'started', session }); focus(session.id); return json(response, 201, session); }
        if (method === 'POST' && url.pathname === '/api/groups/move') return json(response, 200, await sessions.moveGroup(data.group, data.pinned, data.targetId, data.position));
        if (method === 'POST' && url.pathname === '/api/groups/rename') {
          // A renamed group keeps its color and collapsed state; merging into an
          // existing group keeps that group's.
          const from = groupLabel(data.from), to = groupLabel(data.to);
          const merging = sessions.list().some(item => item.group === to);
          const result = await sessions.renameGroup(from, to);
          if (from !== to) {
            const { [from]: color, ...colors } = settings.groupColors || {};
            settings.groupColors = color && !merging ? { ...colors, [to]: color } : colors;
            const collapsed = settings.collapsedGroups || [];
            settings.collapsedGroups = [...new Set(collapsed.filter(item => item !== from).concat(collapsed.includes(from) && !merging ? [to] : []))];
            await saveSettings(); broadcast('settings', { settings });
          }
          return json(response, 200, result);
        }
        if (method === 'GET' && url.pathname === '/api/chat-projects') return json(response, 200, { ...await chatProjects(repo, projectsRoot()), custom: Boolean(settings.projectsDir) });
        if (method === 'POST' && url.pathname === '/api/chat-projects') return json(response, 201, await createChatProject(repo, data.name, projectsRoot()));
        if (method === 'POST' && url.pathname === '/api/projects-folder/pick') {
          if (typeof data.requestId !== 'string' || !/^[a-f\d-]{36}$/i.test(data.requestId)) throw new Error('Invalid folder picker request.');
          native({ type: 'pick-folder', requestId: data.requestId, title: 'Choose your projects folder' });
          return json(response, 200, { requested: true });
        }
        if (method === 'POST' && url.pathname === '/api/projects-folder') {
          if (data.path === null) settings.projectsDir = null;
          else {
            const folder = typeof data.path === 'string' ? path.resolve(data.path) : '';
            if (!folder || !path.isAbsolute(String(data.path)) || !(await stat(folder).then(item => item.isDirectory(), () => false))) throw Object.assign(new Error('Choose an existing folder.'), { status: 400 });
            settings.projectsDir = folder;
          }
          await saveSettings(); broadcast('settings', { settings });
          return json(response, 200, { ...await chatProjects(repo, projectsRoot()), custom: Boolean(settings.projectsDir) });
        }
        // First-run setup. Every step can also be revisited later from Settings.
        if (method === 'GET' && url.pathname === '/api/setup') {
          return json(response, 200, { done: settings.setupDone === true, profile: { name: settings.ownerName || '', nickname: settings.nickname || '' }, projects: { root: projectsRoot(), custom: Boolean(settings.projectsDir) },
            agents: await agentStatus(setupOptions), starter: await capabilities.starter(), starterRunning, elevenlabs: await elevenLabsStatus(repo) });
        }
        if (method === 'POST' && url.pathname === '/api/setup/profile') {
          const profile = await saveProfile(repo, data);
          Object.assign(settings, profile); await saveSettings(); broadcast('settings', { settings });
          syncAgentRules(repo, { nickname: profile.nickname, ...setupOptions }).catch(() => {});
          return json(response, 200, profile);
        }
        if (method === 'POST' && url.pathname === '/api/setup/agent') {
          const agent = (await agentStatus(setupOptions)).find(item => item.id === data.agent);
          if (!agent || !['install', 'signin'].includes(data.action) || (agent.requirement && data.action !== 'install')) throw Object.assign(new Error('Choose something to install or sign in to.'), { status: 400 });
          const cwd = projectsRoot(); await mkdir(cwd, { recursive: true });
          let session;
          if (data.action === 'install') {
            if (!agent.install) throw Object.assign(new Error(agent.note || `Install ${agent.label} by hand: ${agent.docs}`), { status: 409 });
            session = await sessions.create({ agent: 'shell', cwd, name: `Install ${agent.label}` });
            // The shell needs a moment to show its prompt before the command is typed.
            setTimeout(() => { try { sessions.input(session.id, `${agent.install}\r`); } catch { /* The tab was closed. */ } }, 1500);
          } else {
            if (!agent.installed) throw Object.assign(new Error(`Install ${agent.label} first.`), { status: 409 });
            // A first run of the CLI walks through its own browser sign-in.
            session = await sessions.create({ agent: agent.id, cwd, name: `Sign In To ${agent.label}`, bypass: false });
          }
          focus(session.id);
          return json(response, 201, { sessionId: session.id });
        }
        if (method === 'POST' && url.pathname === '/api/setup/starter') {
          if (starterRunning) return json(response, 202, { started: false, running: true });
          if (data.acceptHooks !== true) throw Object.assign(new Error('Agree to install the starter tools, including any hooks they add.'), { status: 400 });
          starterRunning = true;
          capabilities.installStarter({ acceptHooks: true, onProgress: progress => broadcast('setup-progress', { progress }) })
            .then(result => broadcast('setup-progress', { done: result }))
            .catch(error => broadcast('setup-progress', { error: publicError(error) }))
            .finally(() => { starterRunning = false; });
          return json(response, 202, { started: true });
        }
        if (method === 'POST' && url.pathname === '/api/setup/elevenlabs/voices') return json(response, 200, { voices: await elevenLabsVoices(data.key, setupOptions.fetcher) });
        if (method === 'POST' && url.pathname === '/api/setup/elevenlabs') return json(response, 200, await saveElevenLabs(repo, data, setupOptions.fetcher));
        if (method === 'POST' && url.pathname === '/api/setup/done') {
          settings.setupDone = data.done !== false; await saveSettings(); broadcast('settings', { settings });
          return json(response, 200, { done: settings.setupDone });
        }
        // App updates are checked and installed by the desktop shell; results arrive as a window event.
        if (method === 'POST' && url.pathname === '/api/update') {
          if (!['check', 'install'].includes(data.action)) throw Object.assign(new Error('Unknown update action.'), { status: 400 });
          native({ type: `update-${data.action}` });
          return json(response, 202, { requested: true });
        }
        if (method === 'POST' && url.pathname === '/api/groups/delete') {
          // The group's color and collapsed state go with it; the chats stay.
          const name = groupLabel(data.name);
          const result = await sessions.deleteGroup(name);
          const colors = { ...(settings.groupColors || {}) }; delete colors[name];
          settings.groupColors = colors;
          settings.collapsedGroups = (settings.collapsedGroups || []).filter(item => item !== name);
          await saveSettings(); broadcast('settings', { settings });
          return json(response, 200, result);
        }
        const sessionRoute = /^\/api\/sessions\/([\w-]+)(?:\/(\w+))?$/.exec(url.pathname);
        if (sessionRoute) {
          const [, id, action] = sessionRoute;
          if (method === 'GET' && action === 'screen') return json(response, 200, await sessions.read(id));
          if (method === 'GET' && action === 'messages') {
            const session = sessions.get(id);
            const value = await conversationMedia.present(await transcripts.read(session), session, 'desktop', grant => `/media/${session.id}/${grant}`);
            return json(response, 200, { ...value, prompt: session.process ? await readPrompt(sessions, id) : null });
          }
          if (method === 'GET' && action === 'commands') { const session = sessions.get(id); return json(response, 200, await chatCommands(session.agent, session.cwd, mcpOptions)); }
          if (method === 'GET' && action === 'stats') {
            const { supported, userMessages = 0, truncated = false, model = null } = await transcripts.read(sessions.get(id));
            return json(response, 200, { supported, userMessages, truncated, model, handoff: handoffs.state(id) });
          }
          if (method === 'POST' && action === 'handoff') return json(response, 200, handoffs.start(id));
          if (method === 'POST' && action === 'prompt') return json(response, 200, await answerPrompt(sessions, id, data.id, data.choice));
          if (method === 'POST' && action === 'rewind') return json(response, 200, await rewindToMessage(sessions, transcripts, id, String(data.messageId || '')));
          if (method === 'POST' && action === 'speak') {
            const controller = new AbortController(), abort = () => controller.abort();
            sessions.get(id); response.once('close', abort);
            try {
              const audio = await readAloud.synthesize('desktop', data, controller.signal);
              response.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': audio.length, 'Cache-Control': 'no-store' }); response.end(audio); return;
            } finally { response.off('close', abort); }
          }
          if (method === 'POST' && action === 'send') {
            // One prompt: the text and any attached paths are pasted together, then submitted.
            const session = sessions.get(id), text = typeof data.text === 'string' ? data.text : '';
            const paths = Array.isArray(data.paths) && data.paths.length ? await attachments.paths(data.paths) : [];
            if (!text.trim() && !paths.length) throw new Error('Write a message or attach a file.');
            return json(response, 200, sessions.input(id, `${text}${paths.length ? `${text ? '\n' : ''}${attachmentText(paths, session.agent)}` : ''}`, { coordinator: true, submit: true }));
          }
          if (method === 'POST' && action === 'focus') return json(response, 200, focus(id));
          if (method === 'POST' && action === 'stop') return json(response, 200, sessions.stop(id));
          if (method === 'POST' && action === 'resume') { const session = await sessions.resume(id, data.nativeId); focus(id); return json(response, 200, session); }
          if (method === 'POST' && action === 'attach') return json(response, 200, await attach(id, data.paths));
          if (method === 'POST' && action === 'clear') return json(response, 200, await sessions.clearScreen(id));
          if (method === 'POST' && action === 'reorder') return json(response, 200, await sessions.reorder(id, data.targetId, data.position));
          if (method === 'POST' && action === 'input') return json(response, 200, sessions.input(id, data.text, { coordinator: data.paste !== false, submit: data.submit !== false }));
          if (method === 'PATCH' && !action) return json(response, 200, typeof data.pinned === 'boolean' ? sessions.pin(id, data.pinned) : 'tabColor' in data ? sessions.color(id, data.tabColor) : 'group' in data ? await sessions.assign(id, data.group) : sessions.rename(id, data.name));
          if (method === 'DELETE' && !action) return json(response, 200, await closeChat(id));
          if (method === 'DELETE' && action === 'history') {
            // Removes Jupiter's record of the chat; native CLI transcripts stay on disk.
            const result = await sessions.forget(id);
            if (selectedId === id) { selectedId = sessions.active()[0]?.id || null; settings.selectedId = selectedId; scheduleSettings(); broadcast('selection', { selectedId }); }
            return json(response, 200, result);
          }
        }
        if (method === 'POST' && url.pathname === '/api/window') {
          if (!['chats', 'workspace'].includes(data.window) || !['show', 'hide', 'minimize', 'pin'].includes(data.action)) throw new Error('Unknown window action');
          native({ type: 'window', action: data.action, window: data.window, value: !!data.value }); return json(response, 200, { requested: true });
        }
        if (method === 'POST' && url.pathname === '/api/reveal') {
          const file = await realpath(path.resolve(data.path));
          native({ type: 'reveal', path: file }); return json(response, 200, { requested: true });
        }
        if (method === 'POST' && url.pathname === '/api/coordinator') return json(response, 200, await askJupiter(data));
        if (method === 'GET' && url.pathname === '/api/voice') return json(response, 200, { wake: wake.state, wakeWord: wakeWanted(), live: Boolean(parseEnv(await readFile(path.join(repo, '.env'), 'utf8').catch(() => '')).OPENAI_API_KEY || process.env.OPENAI_API_KEY), speaking: await voiceOut.configured(), usage: await voiceOut.usage().catch(() => null) });
        if (method === 'GET' && url.pathname === '/api/voice/weather') return json(response, 200, { place: settings.weatherPlace || 'London', say: url.searchParams.get('say') ? await weather.describe('', settings.weatherPlace || 'London') : undefined });
        if (method === 'POST' && url.pathname === '/api/voice/weather') {
          const wanted = String(data.place || '').trim().slice(0, 80) || 'London';
          const found = await weather.place(wanted);
          settings.weatherPlace = found.name; await saveSettings();
          return json(response, 200, { place: found.name });
        }
        if (method === 'POST' && url.pathname === '/api/voice/wake') {
          settings.wakeWord = data.on === true; await saveSettings();
          const state = settings.wakeWord ? await wake.start() : wake.stop();
          return json(response, 200, { wake: state, wakeWord: settings.wakeWord });
        }
        if (method === 'POST' && url.pathname === '/api/voice/played') {
          wake.mute(false);
          // In a conversation, after an answer, listen for the next thing without "Jupiter".
          if (conversing && ['reply', 'done', 'failed', 'opening'].includes(lastSaid)) { wake.listen(FOLLOW_UP_SECONDS); broadcast('wake-follow', { seconds: FOLLOW_UP_SECONDS }); }
          if (lastSaid === 'bye') broadcast('wake-idle', {});
          return json(response, 200, { listening: true });
        }
        // The J button: listen for one request without the wake word.
        if (method === 'POST' && url.pathname === '/api/voice/listen') { await wake.start(); conversing = true; wake.listen(); broadcast('wake-heard', {}); void say('wake'); return json(response, 200, { listening: true }); }
        // The J button pressed again: stop listening, end the conversation and say goodbye from the
        // phrase bank (saved clips, so nothing is paid for after the first time). Without the wake
        // word the listener is closed, so the microphone is released.
        if (method === 'POST' && url.pathname === '/api/voice/stop') {
          conversing = false; lastSaid = 'bye';
          wake.cancel();
          if (!wakeWanted()) wake.stop();
          broadcast('wake-idle', {});
          try {
            const result = await voiceOut.phrase('farewell');
            if (wakeWanted()) wake.mute(true);
            return json(response, 200, voiceClip(result));
          } catch (error) { return json(response, 200, { url: null, text: PHRASES.farewell[Math.floor(Math.random() * PHRASES.farewell.length)], error: publicError(error) }); }
        }
        // A spoken request the screen couldn't act on goes to the assistant.
        if (method === 'POST' && url.pathname === '/api/voice/ask') { const text = String(data.text || '').trim().slice(0, 2000); if (text) void answer(text); return json(response, 200, { asked: Boolean(text) }); }
        if (method === 'POST' && url.pathname === '/api/voice/say') {
          const result = data.text ? await voiceOut.speak(String(data.text).slice(0, 4000)) : await voiceOut.phrase(String(data.kind || ''));
          return json(response, 200, voiceClip(result, result.text || ''));
        }
        // Opening Brainstorm, To do, Projects or News: a short line every time. News reads its top
        // headline on the first open after Jupiter starts and every twentieth open after that;
        // the rest of the time it says one of its saved lines, so it costs nothing.
        if (method === 'POST' && url.pathname === '/api/voice/greet') {
          const view = String(data.view || '');
          if (!['board', 'todo', 'projects', 'news', 'opening'].includes(view)) return json(response, 400, { error: 'Unknown window.' });
          let result;
          if (view === 'news') {
            const topic = String(data.topic || 'ai');
            const headlines = (await news.topic(topic).catch(() => ({ items: [] }))).items.map(item => item.title);
            const custom = newsOpens++ % 20 === 0 ? newsGreeting(topic, headlines[0]) : null;
            result = custom ? await voiceOut.speak(custom) : await voiceOut.phrase(newsKind(headlines));
          } else result = await voiceOut.phrase(view === 'opening' ? 'opening' : greetingKind(view));
          // Like any spoken answer: don't hear herself, and in a conversation keep listening afterwards.
          lastSaid = 'opening'; wake.mute(true);
          return json(response, 200, voiceClip(result, result.text || ''));
        }
        if (method === 'POST' && url.pathname === '/api/voice/prepare') return json(response, 200, await voiceOut.prepare());
        const voiceFile = /^\/api\/voice\/(clip|audio)\/([^/]+)$/.exec(url.pathname);
        if (voiceFile && method === 'GET') {
          const name = decodeURIComponent(voiceFile[2]);
          const audio = voiceFile[1] === 'audio' ? spoken.get(name) : /^[a-z0-9_]+\.mp3$/.test(name) ? await readFile(path.join(voiceOut.folder, name)).catch(() => null) : null;
          if (!audio) throw Object.assign(new Error('That clip was not found.'), { status: 404 });
          response.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': audio.length, 'Cache-Control': 'no-store' });
          return response.end(audio);
        }
        if (method === 'POST' && url.pathname === '/api/coordinator/prepare') { await coordinator.start(); return json(response, 200, { ready: true, model: coordinator.model }); }
        if (method === 'POST' && url.pathname === '/api/live/transcript') {
          if (typeof data.id !== 'string' || data.id.length > 200 || !Array.isArray(data.captions)) throw new Error('A voice session and captions are required.');
          const captions = data.captions.slice(-50).filter(item => ['user', 'assistant'].includes(item.role) && typeof item.text === 'string').map(item => ({ role: item.role, text: item.text.slice(0, 1000), start: Number(item.start) || 0, end: Number(item.end) || 0 }));
          const transcript = { id: data.id, at: new Date().toISOString(), captions };
          voiceHistory = [...voiceHistory.filter(item => item.id !== data.id), transcript].slice(-12);
          const snapshot = voiceHistory;
          transcriptSave = transcriptSave.catch(() => {}).then(() => saveJson(transcriptPath, snapshot)); await transcriptSave;
          return json(response, 200, { saved: true });
        }
        if (method === 'POST' && url.pathname === '/api/live/release') {
          if (voiceOwner?.clientId === data.clientId) { voiceOwner = null; broadcast('voice-owner', { owner: null }); }
          return json(response, 200, { released: true });
        }
        if (method === 'POST' && url.pathname === '/api/live/session') {
          if (voiceOwner && voiceOwner.clientId !== data.clientId) throw new Error(`Voice is already active in the ${voiceOwner.surface} window`);
          if (typeof data.sdp !== 'string' || !data.sdp.trim() || typeof data.clientId !== 'string') throw new Error('A microphone connection is required');
          const keys = parseEnv(await readFile(path.join(repo, '.env'), 'utf8').catch(() => ''));
          const key = keys.OPENAI_API_KEY || keys.OPENAI_KEY || process.env.OPENAI_API_KEY;
          if (!key) throw new Error('Add OPENAI_API_KEY to the repository .env, then press the nose again.');
          voiceOwner = { clientId: data.clientId, surface: data.surface === 'chats' ? 'chats' : 'workspace' };
          broadcast('voice-owner', { owner: voiceOwner });
          try {
            const result = await fetch('https://api.openai.com/v1/live/sessions', {
              method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(30000),
                body: JSON.stringify({ session: voiceSession(settings), transport: { type: 'webrtc', sdp: data.sdp } }),
            });
            const value = await result.json().catch(() => ({}));
            if (!result.ok) throw new Error(`OpenAI Live (${result.status}): ${value.error?.message || 'Session could not be started'}`);
            return json(response, 201, value);
          } catch (error) { voiceOwner = null; broadcast('voice-owner', { owner: null }); throw error; }
        }
        throw Object.assign(new Error('Endpoint not found'), { status: 404 });
      }
      if (!['GET', 'HEAD'].includes(request.method)) throw Object.assign(new Error('Not allowed'), { status: 405 });
      const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
      const { file, info } = await realFile(uiDir, relative);
      if (!info.isFile()) throw new Error('File not found');
      await serveFile(request, response, file, info, {
        'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
        'Content-Security-Policy': `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob: ${files.origin} https:; media-src 'self' blob: ${files.origin}; connect-src 'self' ws://127.0.0.1:* ${files.origin}; frame-src ${files.origin} https://www.youtube-nocookie.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`,
      });
    } catch (error) { if (!response.headersSent) json(response, error.status || 400, { error: publicError(error) }); }
  });
  const origin = await listen(server);
  files.uiOrigin = origin;
  mobile = await new MobileGateway({ ...mobileOptions, transcripts, readAloud, dictation, chooseDictation, repo, uiDir, stateDir, sessions, attachments, closeChat, settings: () => settings, changed: state => broadcast('mobile-state', { mobile: state }) }).init();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 128 * 1024 });
  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, origin);
    if (request.headers.host !== new URL(origin).host || request.headers.origin !== origin || url.pathname !== '/events') { socket.destroy(); return; }
    wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws));
  });
  wss.on('connection', ws => {
    ws.authenticated = false; ws.sessionId = null;
    const authTimer = setTimeout(() => ws.close(1008, 'Authentication required'), 5000);
    ws.on('message', async raw => {
      try {
        const message = JSON.parse(raw.toString());
        if (!ws.authenticated) {
          if (message.type !== 'auth' || !equalSecret(message.token, token)) return ws.close(1008, 'Authentication failed');
          ws.authenticated = true; ws.clientId = message.clientId; ws.surface = message.surface; clients.add(ws); clearTimeout(authTimer);
          send(ws, 'connected', { sessions: sessions.list(), selectedId, coordinator: coordinator.state }); return;
        }
        if (message.type === 'subscribe') {
          ws.sessionId = message.id;
          const snapshot = await sessions.snapshot(message.id);
          if (ws.sessionId === message.id) send(ws, 'snapshot', snapshot);
        } else if (message.type === 'input') sessions.input(message.id, message.data);
        else if (message.type === 'resize') sessions.resize(message.id, message.cols, message.rows);
        else if (message.type === 'selected') { sessions.get(message.id); selectedId = message.id; settings.selectedId = selectedId; scheduleSettings(); }
        else if (message.type === 'seen' && ws.surface === 'chats' && ws.sessionId === message.id && selectedId === message.id) sessions.seen(message.id, message.completionVersion);
        else if (message.type === 'workspace-route') { workspaceRoute = String(message.route || '').slice(0, 500); settings.workspaceRoute = workspaceRoute; scheduleSettings(); }
        else if (message.type === 'ping') send(ws, 'pong', {});
      } catch (error) { send(ws, 'service-error', { error: publicError(error) }); }
    });
    ws.on('close', () => { clearTimeout(authTimer); clients.delete(ws); if (voiceOwner?.clientId === ws.clientId) { voiceOwner = null; broadcast('voice-owner', { owner: null }); } });
    ws.on('error', () => {});
  });
  let watcher;
  try { watcher = watch(path.join(repo, 'workspace', 'workspace.json'), () => broadcast('workspace-changed', {})); watcher.on('error', () => {}); } catch { /* Registry may be created after first setup. */ }
  const restoreTimer = restoreSessions ? setTimeout(() => sessions.restore().catch(error => sessions.emit('service-error', error)), 100) : null;
  return {
    origin, contentOrigin: files.origin, token, sessions, coordinator, quick, workItems, workspace, cards, files, projects, knowledge, integrations, mobile,
    urls: { workspace: `${origin}/?desktop=1&surface=workspace&token=${token}`, chats: `${origin}/?desktop=1&surface=chats&token=${token}` },
      nativeMessage: event => nativeSettings.receive(event),
      async close() {
        if (closing) return; closing = true; mcp.close(); connections.close(); wake.stop(); editors.stopAll(); nativeSettings.close(); await files.writes.catch(() => {});
      watcher?.close(); workspace.close(); clearTimeout(restoreTimer); coordinator.close(); clearTimeout(settingsTimer); await saveSettings(); await transcriptSave; await quick.saves; await workspace.writes;
      dictation.close(); await mobile.close();
      for (const ws of wss.clients) ws.terminate();
      wss.close(); await sessions.close();
      server.closeAllConnections(); contentServer.closeAllConnections();
      await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => contentServer.close(resolve))]);
    },
  };
}
