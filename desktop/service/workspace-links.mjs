// Links to Workspace cards ("http://127.0.0.1:5187/#/ashengard-8b5961c4", "#/ashengard-8b5961c4/2").
// A card link opens inside Jupiter. Everything else keeps its normal behaviour: other websites, and
// other tools that happen to run on this PC, still open in the browser. Pure functions, used by both
// the interface (a cheap check before it asks the service) and the service (the real decision).

/** Where the interface's own dev server and `vite preview` normally listen (vite.config.ts, Vite's default). */
export const PREVIEW_PORTS = Object.freeze([3009, 4173]);
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);
const HASH_ROUTE = /^#\/([^/]+)(?:\/(\d+))?\/?$/;

function parse(href, appOrigin) {
  if (typeof href !== 'string' || !href.trim() || href.length > 2000) return null;
  try {
    const url = new URL(href.trim(), appOrigin || 'http://127.0.0.1/');
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    // A bare "#/id" link belongs to the app it was shown in.
    return url;
  } catch { return null; }
}
const where = (url, appOrigin) => {
  const loopback = LOOPBACK.has(url.hostname);
  const own = Boolean(appOrigin) && url.origin === appOrigin;
  return { own, preview: loopback && PREVIEW_PORTS.includes(Number(url.port)), loopback };
};

/**
 * True when a link could be a Jupiter card link, judged from its shape alone: the app's own address or a
 * local address, the root page, and a "#/id" or "#/id/step" route. The service then decides for real.
 */
export function mayBeCardLink(href, appOrigin = '') {
  const url = parse(href, appOrigin);
  if (!url) return false;
  const place = where(url, appOrigin);
  if (!place.own && !place.loopback) return false;
  if (url.pathname !== '/') return false;
  return HASH_ROUTE.test(url.hash) || ((place.own || place.preview) && ['', '#', '#/'].includes(url.hash));
}

/**
 * What a link means, given the registered Workspace cards.
 *   { kind: 'card', id, step, title, note? }   a registered card (step -1 is the card's default page)
 *   { kind: 'home' }                           the Workspace itself
 *   { kind: 'unknown', id }                    the app's own address, but no such card
 *   { kind: 'other' }                          anything else: leave the link alone
 * A card ID that is registered is enough on any local address, because another tool does not use it. An
 * unknown ID only counts as a Jupiter link on the app's own address or a usual preview port; anywhere else it
 * may belong to a different local tool.
 */
export function cardLink(href, { appOrigin = '', entities = [] } = {}) {
  const url = parse(href, appOrigin);
  if (!url || !mayBeCardLink(href, appOrigin)) return { kind: 'other' };
  const place = where(url, appOrigin);
  const match = HASH_ROUTE.exec(url.hash);
  if (!match) return { kind: 'home' };
  let id;
  try { id = decodeURIComponent(match[1]); } catch { return { kind: 'other' }; }
  const entity = entities.find(item => item?.id === id);
  if (!entity) return place.own || place.preview ? { kind: 'unknown', id } : { kind: 'other' };
  let step = match[2] === undefined ? -1 : Number(match[2]);
  const steps = Array.isArray(entity.steps) ? entity.steps.length : 0;
  let note;
  if (step >= steps) { note = `Page ${step + 1} does not exist on this card, so its default page is shown.`; step = -1; }
  return { kind: 'card', id, step, title: entity.title || id, ...(note ? { note } : {}) };
}

/** The sentence shown when a link points at a card that is not in Jupiter. */
export const unknownCardMessage = id => `That Workspace card (${id}) is not in Jupiter. It may have been removed or renamed. Open the Workspace to see the cards that exist.`;
