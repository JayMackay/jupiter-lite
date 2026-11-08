// Ticket requests in plain language ("create a feature ticket to …, have Codex write the details").
// Pure functions only: the Ask bar in the interface and the service both use them.

const TYPE_WORDS = { feature: 'feature', enhancement: 'feature', improvement: 'feature', story: 'feature', task: 'feature', bug: 'bug', defect: 'bug', spike: 'spike', research: 'spike', investigation: 'spike' };
const LEAD = String.raw`^(?:(?:hey |ok |okay )?jupiter[,:]?\s+)?(?:(?:please|kindly)\s+)?(?:(?:can|could|would|will) you\s+(?:please\s+)?|i(?:'d| would) like (?:you )?to\s+|i want (?:you )?to\s+|i need (?:you )?to\s+|go ahead and\s+|let'?s\s+)?(?:please\s+)?`;
const VERB = String.raw`(?:create|add|make|raise|log|file|open|write up|write|draft|put together|set up|register|start|new)`;
const TICKET = new RegExp(`${LEAD}${VERB}\\s+(?:me\\s+)?(?:(?:a|an|another|one|new)\\s+)*(?:(${Object.keys(TYPE_WORDS).join('|')})(?:\\s+(?:request|report))?\\s+)?(?:ticket|work item|board item|todo item|to do item)\\b(.*)$`, 'is');

const AGENT = /\b(codex|claude(?: code)?)\b/i;
const NO_DRAFT = /\b(?:without|skip|no need for|don'?t (?:use|ask|have|need|bother)|do not (?:use|ask|have)|no)\s+(?:the\s+)?(?:codex|claude(?: code)?|jupiter|any ?one|any agent|drafting|details?|description)\b|\b(?:just|only) the title\b|\btitle only\b|\bleave the details (?:blank|empty)\b/i;
const DRAFT_WORDS = /\b(?:write|writes|written|draft|drafts|drafted|flesh|fill|spell|detail|details|describe|description|spec|shape|expand|elaborate|outline|acceptance|criteria|prepare)\b/i;
const WRITE_DETAILS = /(?:,|;|\b(?:and|then|also|please)\b)\s*(?:(?:please|can you|could you)\s+)?(?:write|draft|flesh out|fill in|spell out)\s+(?:up\s+)?(?:the\s+|its\s+)?(?:details?|description|acceptance criteria|spec)\b.*$/i;
const LEAD_WORDS = new Set(['and', 'then', 'also', 'please', 'can', 'could', 'you', 'would', 'will', 'should', 'i', 'want', 'need', 'like', "i'd", 'have', 'let', 'get', 'ask', 'tell', 'make', 'use', 'using', 'with', 'so', 'to', 'the', "let's"]);
const GENERIC_BOARD = /^(?:to ?do|to-do|todo|work|kanban|task|tasks|backlog|main|current|default|my)$/i;
const BOARD = /^\s*(?:(?:on|in|onto|into)\s+(?:the\s+|my\s+)?|to\s+(?:the|my)\s+)([\p{L}\p{N}][\p{L}\p{N}'’&.-]*(?:\s+[\p{L}\p{N}'’&.-]+){0,3}?)\s+(board|list|backlog)\b/iu;
const BOARD_END = /\s+(?:on|in|onto|into|to)\s+(?:the|my)\s+([\p{L}\p{N}][\p{L}\p{N}'’&.-]*(?:\s+[\p{L}\p{N}'’&.-]+){0,3}?)\s+board\s*$/iu;
const CONNECTOR = /^\s*(?:[:\-–—]\s*)?(?:(?:for|to|about|on|called|named|titled|saying|that says|that|so that|which|regarding)\s+)?/i;
const TITLE_MAX = 100;

const tidy = text => String(text).replace(/\s+/g, ' ').replace(/^[\s,;:.\-–—]+|[\s,;:.\-–—!?]+$/g, '').trim();

// Where a drafting instruction starts inside the text, walking back over words like "and have" or "using".
function draftingStart(text) {
  const tokens = [...text.matchAll(/\S+/g)].map(match => ({ text: match[0], start: match.index }));
  const back = index => {
    let at = tokens.findIndex(token => token.start >= index);
    if (at < 0) return index;
    let start = tokens[at].start;
    for (at -= 1; at >= 0; at--) {
      if (!LEAD_WORDS.has(tokens[at].text.toLowerCase().replace(/[^a-z']/g, ''))) break;
      start = tokens[at].start;
      if (/[,;.]$/.test(tokens[at].text)) break;
    }
    return start;
  };
  const found = [];
  const agent = AGENT.exec(text);
  if (agent) {
    const start = back(agent.index);
    const clause = text.slice(start);
    if (DRAFT_WORDS.test(clause) || NO_DRAFT.test(clause)) found.push(start);
  }
  const none = NO_DRAFT.exec(text);
  if (none) found.push(back(none.index));
  const write = WRITE_DETAILS.exec(text);
  if (write) found.push(write.index);
  return found.length ? Math.min(...found) : -1;
}

function titleOf(description) {
  const text = tidy(description);
  if (!text) return '';
  const first = text.split(/(?<=[.!?])\s+/)[0];
  let title = first.length <= TITLE_MAX ? first : text.slice(0, TITLE_MAX + 1).replace(/\s+\S*$/, '');
  title = tidy(title) || tidy(text.slice(0, TITLE_MAX));
  return title.charAt(0).toUpperCase() + title.slice(1);
}

/**
 * Recognises a request to create a ticket. Returns null for anything else.
 * { type, title, description, request, board, draft, explicit }
 *   draft: 'codex' (the default), 'claude' or 'none'; explicit: the user said who drafts, or that nobody does.
 */
export function parseTicketRequest(text) {
  if (typeof text !== 'string') return null;
  const request = text.trim();
  const match = TICKET.exec(request);
  if (!match) return null;
  let rest = match[2] || '';
  let draft = 'codex', explicit = false;
  const cut = draftingStart(rest);
  if (cut >= 0) {
    const tail = rest.slice(cut);
    rest = rest.slice(0, cut).replace(/[\s,;:.]+$/, '');
    explicit = true;
    if (NO_DRAFT.test(tail)) draft = 'none';
    else { const named = AGENT.exec(tail); if (named) draft = /claude/i.test(named[1]) ? 'claude' : 'codex'; else explicit = false; }
  }
  let board = null;
  const named = BOARD.exec(rest);
  if (named) {
    const generic = GENERIC_BOARD.test(named[1].trim());
    if (named[2].toLowerCase() === 'board' || generic) { rest = rest.slice(named[0].length); if (!generic) board = named[1].trim(); }
  } else {
    const end = BOARD_END.exec(rest);
    if (end && !GENERIC_BOARD.test(end[1].trim())) { board = end[1].trim(); rest = rest.slice(0, end.index); }
  }
  const description = tidy(rest.replace(CONNECTOR, ''));
  const type = TYPE_WORDS[(match[1] || 'feature').toLowerCase()];
  return { type, title: titleOf(description), description, request, board, draft, explicit };
}

const key = value => String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
/** Two titles that differ only in case, spacing or punctuation are the same ticket. */
export const titleKey = key;

/** The board a name points to: its exact title or slug, or the one board whose title contains it. */
export function resolveBoard(boards, name) {
  const wanted = key(name);
  if (!wanted) return null;
  const exact = boards.find(board => key(board.title) === wanted || key(board.slug) === wanted);
  if (exact) return exact;
  const close = boards.filter(board => key(board.title).includes(wanted) || key(board.slug).includes(wanted));
  return close.length === 1 ? close[0] : null;
}

/** What a ticket holds while its details are being drafted: the user's own request, nothing more. */
export const draftSeed = description => `## Request\n\n${String(description || '').trim()}\n`;
const quote = text => String(text).trim().slice(0, 4000).split(/\r?\n/).map(line => `> ${line}`).join('\n');
const AGENT_NAMES = { codex: 'Codex', claude: 'Claude Code' };
export const agentName = agent => AGENT_NAMES[agent] || 'The agent';
/** "the Project Jupiter board", and "the My board" is avoided: a title that already ends in board is not given a second one. */
export const boardPlace = title => { const name = String(title || '').trim(); return !name ? 'the board' : /\bboard$/i.test(name) ? `the ${name}` : `the ${name} board`; };

/** True while the details are still only the request (or empty), so a draft is still wanted. */
export const isPlaceholder = details => { const text = String(details || '').trim(); return !text || (/^## Request\n/.test(text) && !/\n## /.test(text)); };

export function draftBrief({ board, item, request, agent }) {
  const kind = { feature: 'feature', bug: 'bug', spike: 'spike (research)' }[item.type] || 'feature';
  return [
    `Draft the details for one ticket on my Jupiter work board. ${agentName(agent)}, this is a ticket to write up, not the work itself.`, '',
    `Ticket: "${item.title}" (${kind}, id "${item.id}")`,
    `Board: "${board.title}" (file knowledge/work/${board.slug}.json)`, '',
    'My request, exactly as I wrote it:', quote(request || item.title), '',
    'What to do:',
    `1. Open knowledge/work/${board.slug}.json and find the item with id "${item.id}". Edit only that item. Do not add another item, and do not change its id, title, type, state or board.`,
    '2. Write its "details" as Markdown: what is wanted and why, based on my request. Keep a short "Request" section at the top with my words unchanged.',
    '3. Write "acceptance" as a short Markdown checklist of criteria someone can test. Add "tasks" (each { "title": "...", "done": false }) only if the work clearly splits into steps.',
    '4. Do not invent facts. If I did not give a value (a number, speed, date, size or name), do not choose one and do not present a guess as a requirement. Write "Not specified" and list it under "Open questions" for me to decide.',
    '5. Read the code only as far as you need to name the right places. Do not make the change itself.',
    '6. Keep the JSON valid and every other item unchanged. Save the file, then tell me in one line that the details are saved.',
  ].join('\n');
}

/** After the drafting chat has finished: did the board really get the details, and is it still one ticket? */
export function checkDraft({ board, id, seed, title, agent = 'codex' }) {
  const who = agentName(agent), place = boardPlace(board.title);
  const item = board.items.find(entry => entry.id === id);
  const name = item?.title || title;
  if (!item) return { ok: false, text: `${who} finished, but "${name}" is no longer on ${place}. Please check the board.` };
  const same = board.items.filter(entry => titleKey(entry.title) === titleKey(item.title));
  if (same.length > 1) return { ok: false, text: `${who} finished, but there are now ${same.length} tickets called "${item.title}" on ${place}. Please check the board.` };
  const details = String(item.details || '').trim(), written = details && details !== String(seed || '').trim();
  if (!written && !String(item.acceptance || '').trim()) return { ok: false, text: `${who} finished, but the details for "${item.title}" were not saved. The ticket is still on ${place} with only your request.` };
  return { ok: true, text: `${who} saved the details for "${item.title}" on ${place}.` };
}
