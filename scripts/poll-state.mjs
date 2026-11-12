/** Table poll rules. No Foundry or transport dependencies. Several polls at once; no options means free-text answers. */
export const MAX_OPTIONS = 8;
export const MAX_QUESTION = 200;
export const MAX_ANSWER = 200;
// Asking past this drops the oldest closed poll; with every poll still open, asking is refused.
export const MAX_POLLS = 20;

/** `lastId` keeps poll IDs unique after removals, so a stale answer can't land on a newer poll. */
export function emptyPolls() {
  return { version: 2, revision: 0, lastId: 0, polls: [] };
}

const clean = (value, max) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '';
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
const validAnswer = (poll, value) => poll.options.length
  ? Number.isSafeInteger(value) && value >= 0 && value < poll.options.length
  : typeof value === 'string' && value.length > 0 && value.length <= MAX_ANSWER;

/** Distinct, non-empty option labels; fewer than two means a free-text poll. */
export function readOptions(input) {
  const options = [...new Set((Array.isArray(input) ? input : []).map(option => clean(option, MAX_ANSWER)).filter(Boolean))].slice(0, MAX_OPTIONS);
  return options.length >= 2 ? options : [];
}

/** One poll, or null if it has no ID, question or asker. */
export function readPoll(input, isUser = () => true) {
  const question = clean(input?.question, MAX_QUESTION);
  if (!question || !count(input.id) || typeof input.askerId !== 'string') return null;
  const poll = { id: input.id, question, options: readOptions(input.options), anonymous: input.anonymous === true, askerId: input.askerId, open: input.open === true, answers: {} };
  for (const [id, value] of Object.entries(input.answers && typeof input.answers === 'object' ? input.answers : {})) {
    if (isUser(id) && validAnswer(poll, value)) poll.answers[id] = value;
  }
  return poll;
}

export function readPolls(input, isUser = () => true) {
  const state = emptyPolls();
  if (!input || input.version !== 2) return state;
  state.revision = count(input.revision);
  const ids = new Set();
  for (const poll of (Array.isArray(input.polls) ? input.polls : []).map(poll => readPoll(poll, isUser))) {
    if (poll && !ids.has(poll.id)) { ids.add(poll.id); state.polls.push(poll); }
  }
  state.polls = state.polls.slice(-MAX_POLLS);
  state.lastId = Math.max(count(input.lastId), ...ids);
  return state;
}

/** Anyone may ask; a poll's asker or a GM may close or remove it. Only players answer. */
export function pollTransition(previous, command, actor, { isPlayer: isUser = () => true, now = 0 } = {}) {
  if (!actor?.id || !command || typeof command.type !== 'string' || !isUser(actor.id)) return previous;
  const state = readPolls(previous, isUser);
  if (command.type === 'ask') {
    const question = clean(command.question, MAX_QUESTION);
    if (!question) return previous;
    if (state.polls.length >= MAX_POLLS) {
      const oldest = state.polls.findIndex(poll => !poll.open);
      if (oldest < 0) return previous;
      state.polls.splice(oldest, 1);
    }
    state.lastId = Math.max(now, state.lastId + 1);
    state.polls.push({ id: state.lastId, question, options: readOptions(command.options), anonymous: command.anonymous === true, askerId: actor.id, open: true, answers: {} });
    return state;
  }
  const poll = state.polls.find(poll => poll.id === command.pollId);
  if (!poll) return previous;
  const owner = actor.isGM || poll.askerId === actor.id;
  switch (command.type) {
    case 'answer': {
      const value = poll.options.length ? command.value : clean(command.value, MAX_ANSWER);
      // GMs only watch the results.
      if (actor.isGM || !poll.open || !validAnswer(poll, value) || poll.answers[actor.id] === value) return previous;
      poll.answers[actor.id] = value;
      return state;
    }
    case 'close':
      if (!poll.open || !owner) return previous;
      poll.open = false;
      return state;
    case 'clear':
      if (!owner) return previous;
      state.polls = state.polls.filter(other => other !== poll);
      return state;
    default: return previous;
  }
}

export const POLL_RULES = { empty: emptyPolls, read: readPolls, transition: pollTransition };

/** Per-option vote counts and voter IDs, plus free-text answers; voter IDs are empty for anonymous polls. */
export function pollResults(poll) {
  const entries = Object.entries(poll.answers);
  const results = {
    total: entries.length,
    options: poll.options.map((label, index) => {
      const voters = entries.filter(([, value]) => value === index).map(([id]) => id);
      return { label, count: voters.length, voters: poll.anonymous ? [] : voters };
    }),
    texts: poll.options.length ? [] : entries.map(([id, text]) => ({ userId: poll.anonymous ? null : id, text }))
  };
  // Anonymous free text: hide who wrote which line by sorting.
  if (poll.anonymous) results.texts.sort((a, b) => a.text.localeCompare(b.text));
  return results;
}
