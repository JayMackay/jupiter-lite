// Creating a ticket on a work board and having an agent (Codex by default) draft its details.
// One ticket per request: a repeat finds the ticket that is already there instead of adding another.
import { randomUUID } from 'node:crypto';
import { publicError } from './util.mjs';
import { agentName, boardPlace, checkDraft, draftBrief, draftSeed, isPlaceholder, resolveBoard, titleKey } from './ticket-requests.mjs';

const KINDS = { feature: 'Feature', bug: 'Bug', spike: 'Spike' };
const chains = new Map();
// Saves for one board run one after another, so two requests cannot both miss each other's ticket.
function serial(key, work) {
  const next = (chains.get(key) || Promise.resolve()).catch(() => {}).then(work);
  const tail = next.catch(() => {});
  chains.set(key, tail);
  tail.then(() => { if (chains.get(key) === tail) chains.delete(key); });
  return next;
}
const text = value => String(value ?? '').trim();
const sentence = value => `${text(value).replace(/[.!?\s]+$/, '')}.`;

/**
 * openChat({ agent, name, brief }) starts the visible drafting chat and returns { id, name }.
 * shown(slug) brings the board on screen.
 */
export function createTickets({ workItems, openChat, shown = () => {} }) {
  const drafting = new Map(); // chat id -> the ticket it is writing
  const draftingFor = (slug, id) => [...drafting.values()].some(job => job.slug === slug && job.id === id);

  async function startDraft({ board, item, request, agent, seed }) {
    const label = agentName(agent);
    try {
      const chat = await openChat({ agent, name: /[^ -~]/.test(item.title) ? 'Ticket details' : `Ticket details ${item.title}`.slice(0, 60), brief: draftBrief({ board, item, request, agent }) });
      drafting.set(chat.id, { slug: board.slug, id: item.id, title: item.title, seed, agent, seen: false });
      return { drafting: { agent, chat: chat.name }, said: ` ${label} is drafting the details in the chat "${chat.name}". They are not saved yet, and I will tell you when they are.` };
    } catch (error) {
      return { drafting: { agent, error: publicError(error) }, said: ` I could not start ${label} to draft the details: ${sentence(publicError(error))} The ticket has no details yet.` };
    }
  }

  return {
    drafting,
    async add(args = {}, { request = '' } = {}) {
      const title = text(args.title).replace(/\s+/g, ' ').slice(0, 500);
      if (!title) throw new Error('What should the ticket say? Tell me what it is for, for example "create a feature ticket to speed up saving".');
      const boards = await workItems.list();
      const wanted = text(args.board);
      let target = null;
      if (wanted) {
        target = resolveBoard(boards, wanted);
        if (!target) throw new Error(`There is no board called "${wanted}". ${boards.length ? `Boards: ${boards.map(row => row.title).sort((a, b) => a.localeCompare(b)).join(', ')}.` : 'There are no boards yet.'}`);
      } else target = boards[0] || await workItems.create({ title: 'My board' });
      const type = KINDS[args.type] ? args.type : 'feature';
      const given = [args.details, args.acceptance].some(value => text(value)) || (Array.isArray(args.tasks) && args.tasks.some(task => text(task)));
      const wantedAgent = args.draft === 'none' ? null : ['codex', 'claude'].includes(args.draft) ? args.draft : given ? null : 'codex';
      const asked = text(request) || title;
      const seed = draftSeed(args.description || title);

      return serial(target.slug, async () => {
        const board = await workItems.read(target.slug);
        const place = boardPlace(board.title);
        const existing = board.items.find(item => item.state !== 'done' && titleKey(item.title) === titleKey(title));
        if (existing) {
          const base = `"${existing.title}" is already on ${place}, so I did not add another.`;
          shown(board.slug);
          if (draftingFor(board.slug, existing.id)) return { added: existing.title, type: existing.type, board: board.title, id: existing.id, tasks: existing.tasks.length, saved: true, duplicate: true, drafting: null, report: `${base} ${agentName(wantedAgent || 'codex')} is already drafting its details.` };
          if (!isPlaceholder(existing.details) || text(existing.acceptance)) return { added: existing.title, type: existing.type, board: board.title, id: existing.id, tasks: existing.tasks.length, saved: true, duplicate: true, drafting: null, report: `${base} It already has details, which I left as they are.` };
          if (!wantedAgent) return { added: existing.title, type: existing.type, board: board.title, id: existing.id, tasks: existing.tasks.length, saved: true, duplicate: true, drafting: null, report: `${base} It has no details yet.` };
          const started = await startDraft({ board, item: existing, request: asked, agent: wantedAgent, seed: existing.details });
          return { added: existing.title, type: existing.type, board: board.title, id: existing.id, tasks: existing.tasks.length, saved: true, duplicate: true, drafting: started.drafting, report: `${base}${started.said}` };
        }
        const now = new Date().toISOString();
        const tags = (Array.isArray(args.tags) ? args.tags : []).map(tag => text(tag)).filter(Boolean).slice(0, 20);
        for (const name of tags) if (!board.tags?.some(tag => tag.name.toLowerCase() === name.toLowerCase())) board.tags = [...(board.tags || []), { name }];
        const item = {
          id: `w${randomUUID().slice(0, 10)}`, type, title, details: text(args.details) ? String(args.details) : wantedAgent ? seed : '', acceptance: String(args.acceptance || ''),
          state: 'todo', tags, priority: ['low', 'medium', 'high'].includes(args.priority) ? args.priority : 'none', due: null, order: -1, created: now, updated: now,
          tasks: (Array.isArray(args.tasks) ? args.tasks : []).filter(task => text(task)).slice(0, 100).map(task => ({ id: `t${randomUUID().slice(0, 10)}`, title: String(task).slice(0, 500), done: false, state: 'todo', details: '', created: now, completed: null })),
        };
        let saved;
        try { saved = await workItems.save(board.slug, { ...board, items: [item, ...board.items] }); }
        catch (error) { throw new Error(`Could not save the ticket: ${sentence(publicError(error))}`); }
        shown(board.slug);
        const result = { added: item.title, type, board: saved.title, id: item.id, tasks: item.tasks.length, saved: true, duplicate: false, drafting: null };
        const base = `Saved the ${KINDS[type]} "${item.title}" on ${boardPlace(saved.title)}.`;
        if (!wantedAgent) return { ...result, report: given ? base : `${base} It has no details yet.` };
        const started = await startDraft({ board: saved, item, request: asked, agent: wantedAgent, seed });
        return { ...result, drafting: started.drafting, report: `${base}${started.said}` };
      });
    },
    /** Feed every session update here. Resolves with what to say once a drafting chat has finished, otherwise null. */
    async observe(session) {
      const job = drafting.get(session?.id);
      if (!job) return null;
      if (session.activity === 'working') job.seen = true;
      const finished = session.status === 'exited' || (job.seen && session.activity === 'idle' && session.completionVersion > 0);
      if (!finished) return null;
      drafting.delete(session.id);
      const who = agentName(job.agent);
      if (session.status === 'exited' && !job.seen) return { ok: false, slug: job.slug, text: `${who} stopped before it started drafting the details for "${job.title}". The ticket is still on the board with only your request.` };
      const board = await workItems.read(job.slug).catch(() => null);
      if (!board) return { ok: false, slug: job.slug, text: `${who} finished, but I could not read the board to check "${job.title}".` };
      return { slug: job.slug, ...checkDraft({ board, id: job.id, seed: job.seed, title: job.title, agent: job.agent }) };
    },
  };
}
