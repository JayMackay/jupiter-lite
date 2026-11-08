// What Jupiter says when a window opens on the dashboard. Each window has about twenty lines:
// some for any time and a few for the morning, afternoon, evening and late at night.
// The fixed lines are recorded once and kept as clips, so they cost nothing after the first time.

export const VIEW_LINES = {
  board: {
    any: [
      'Brainstorm time. What are we dreaming up?',
      'Want to pick up where we left off?',
      'Blank canvas, boss. Talk and I’ll pin it.',
      'Right, let’s get some ideas down.',
      'Go on then, hit me with your ideas.',
      'Ideas board’s ready. Where do we start?',
      'What’s rattling around in your head today?',
      'Let’s map it out. I’m listening.',
      'Back to the drawing board, in a good way.',
      'Say it out loud, I’ll catch the ideas.',
      'Fresh ideas, or building on the last lot?',
      'Let’s make a mess and tidy it later.',
    ],
    morning: ['Good morning, sir. Fresh mind, fresh ideas.', 'Morning, boss. What’s the big idea today?'],
    afternoon: ['Afternoon, boss. Time for some thinking?', 'Afternoon. Let’s shake a few ideas loose.'],
    evening: ['Evening, boss. One more idea before the day’s out?', 'Evening. Let’s get it on the board while it’s fresh.'],
    late: ['Late one, boss. What’s the plan?', 'Burning the midnight oil? Let’s make it count.'],
  },
  todo: {
    any: [
      'Here’s the board. What are we knocking off first?',
      'Let’s see what’s on the list.',
      'Your board, boss. Anything new to add?',
      'Right, what’s moving today?',
      'Pick one and I’ll keep you honest.',
      'Let’s get something across the line.',
      'Here’s where we stand. Want to add anything?',
      'What’s the priority, boss?',
      'One task at a time. Which one first?',
      'Shall we clear a few of these?',
      'Want me to hand something to Claude?',
      'Let’s keep the momentum going.',
    ],
    morning: ['Good morning, sir. What’s the plan today?', 'Morning, boss. Let’s set up the day.'],
    afternoon: ['Afternoon. How’s the list looking?', 'Afternoon, boss. Halfway there. What’s next?'],
    evening: ['Evening, boss. Anything to wrap up before tonight?', 'Evening. Let’s see what got done today.'],
    late: ['Late today, boss. What’s the plan?', 'Still at it? Let’s pick something small.'],
  },
  projects: {
    any: [
      'Here are your projects. Where are we heading?',
      'Pick up where we left off, boss?',
      'Your projects, boss. Which one today?',
      'Plenty on the go. Pick one and we’ll dive in.',
      'Which project gets the love today?',
      'Here’s everything in flight.',
      'Let’s open something up.',
      'Shall we carry on with the last one?',
      'Take your pick, I’ll bring it up.',
      'Here’s the lot. Anything need a fresh map?',
      'Projects are up. What are we building?',
      'Let’s make some progress, boss.',
    ],
    morning: ['Good morning, sir. Which project first?', 'Morning, boss. Let’s get building.'],
    afternoon: ['Afternoon. Where were we?', 'Afternoon, boss. Time to ship something?'],
    evening: ['Evening, boss. One more push on something?', 'Evening. Let’s tidy up a project before the day’s done.'],
    late: ['Late one, boss. Something quick or something big?', 'Night shift again? Let’s pick one.'],
  },
};

// News, most of the time: saved lines that cost nothing after their first recording.
export const NEWS_LINES = [
  'Looks like there’s a lot going on today.',
  'Here’s what’s happening out there.',
  'Busy news day, boss.',
  'Fresh headlines, hot off the press.',
  'Let’s see what the world’s been up to.',
  'Here’s the latest, boss.',
  'Plenty to catch up on today.',
  'Quick scan of the news?',
  'The world kept turning while you were busy.',
  'Here’s what everyone’s talking about.',
  'News is in. Take your pick.',
  'Some interesting ones today.',
  'Let’s catch you up.',
  'Here’s your briefing, boss.',
  'A few stories worth a look.',
  'Here’s what’s new since you last checked.',
  'Grab a coffee, here’s the news.',
  'The headlines are rolling in.',
  'Here’s the world at a glance.',
  'Anything catch your eye?',
];
// Saved lines that only play when they're true: a top story in the open tab matches.
export const NEWS_TOPICAL = [
  [/\btrump\b/i, 'Seems like Trump is at it again.'],
  [/\b(openai|chatgpt|sam altman)\b/i, 'OpenAI’s in the headlines again.'],
  [/\b(anthropic|claude)\b/i, 'Anthropic’s making news today.'],
  [/\b(apple|iphone|ipad|macbook)\b/i, 'Apple’s up to something again.'],
  [/\b(nvidia)\b/i, 'Nvidia’s in the news again.'],
  [/\b(bitcoin|crypto)/i, 'Crypto’s on the move again.'],
  [/\b(stocks?|markets?|ftse|shares|wall street)\b/i, 'The markets are busy today.'],
  [/\b(elections?|polls?|votes?|voters)\b/i, 'Politics is heating up.'],
];

// News, on the first open and every twentieth after: a personal opener for the open tab, then
// its top headline. Spoken fresh, so it uses credits (about 100 a time).
export const NEWS_OPENERS = {
  ai: ['Looks like today in AI', 'Big one in AI', 'Here’s what’s moving in AI'],
  agentic: ['In the agent world today', 'Agents news, boss'],
  tech: ['Top of tech today', 'Over in tech'],
  uk: ['At home today', 'Top story in the UK'],
  world: ['Around the world today', 'Top world story'],
  gaming: ['Interesting one in gaming', 'Over in gaming'],
  finance: ['In the markets today', 'Money news, boss'],
};

/** morning 5 to 12, afternoon to 17, evening to 22, late otherwise. */
export const partOfDay = (hour = new Date().getHours()) => hour >= 5 && hour < 12 ? 'morning' : hour >= 12 && hour < 17 ? 'afternoon' : hour >= 17 && hour < 22 ? 'evening' : 'late';

/** The phrase bank entries: board_any, board_morning, ... */
export const greetingPhrases = () => ({
  ...Object.fromEntries(Object.entries(VIEW_LINES).flatMap(([view, parts]) => Object.entries(parts).map(([part, lines]) => [`${view}_${part}`, lines]))),
  news_any: NEWS_LINES,
  ...Object.fromEntries(NEWS_TOPICAL.map(([, line], index) => [`news_topical_${index}`, [line]])),
});

/** A saved News line: one about a top story when one fits (half the time), otherwise a general one. */
export function newsKind(headlines = [], random = Math.random) {
  const text = headlines.slice(0, 5).join(' ');
  const fits = NEWS_TOPICAL.map(([pattern], index) => pattern.test(text) ? index : -1).filter(index => index >= 0);
  return fits.length && random() < 0.5 ? `news_topical_${fits[Math.floor(random() * fits.length)]}` : 'news_any';
}

/** Which phrase kind to use for a window: usually a line for any time, sometimes one for the time of day. */
export function greetingKind(view, { hour = new Date().getHours(), random = Math.random } = {}) {
  const parts = VIEW_LINES[view];
  if (!parts) return null;
  const part = partOfDay(hour);
  return parts[part] && random() < 0.4 ? `${view}_${part}` : `${view}_any`;
}

/** "Interesting one in gaming: <headline>." */
export function newsGreeting(topic, headline, random = Math.random) {
  const openers = NEWS_OPENERS[topic] || NEWS_OPENERS.ai;
  const title = String(headline || '').replace(/\s*\|.*$/, '').replace(/\s+/g, ' ').trim().replace(/[.!?]+$/, '');
  if (!title) return null;
  return `${openers[Math.floor(random() * openers.length)]}: ${title}.`;
}
