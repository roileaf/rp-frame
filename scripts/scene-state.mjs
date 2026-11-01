/** RP scene rules. No Foundry or transport dependencies. */
export function emptyScene() {
  // `since`: when the current speaker's turn began (GM clock), for the banner's turn timer.
  return { version: 1, revision: 0, active: false, participants: [], urgent: [], speaker: null, since: null };
}

export function readScene(input, isPlayer = () => true) {
  const state = emptyScene();
  if (!input || input.version !== 1) return state;
  state.revision = Number.isSafeInteger(input.revision) && input.revision >= 0 ? input.revision : 0;
  state.active = input.active === true;
  state.participants = [...new Set(Array.isArray(input.participants) ? input.participants : [])]
    .filter(id => typeof id === 'string' && isPlayer(id));
  state.speaker = state.active && state.participants.includes(input.speaker) ? input.speaker : null;
  state.urgent = [...new Set(Array.isArray(input.urgent) ? input.urgent : [])]
    .filter(id => state.participants.includes(id) && id !== state.speaker);
  state.since = state.speaker && Number.isSafeInteger(input.since) ? input.since : null;
  return state;
}

export function waitingOrder(state) {
  const waiting = state.participants.filter(id => id !== state.speaker);
  return [...waiting.filter(id => state.urgent.includes(id)), ...waiting.filter(id => !state.urgent.includes(id))];
}

/** Only authenticated GMs may manage others. Players act on themselves. */
export function transition(previous, command, actor, { isPlayer = () => true, combat = false, now = 0 } = {}) {
  if (!actor?.id || !command || typeof command.type !== 'string') return previous;
  const gmActions = ['start', 'end', 'choose', 'remove', 'next'];
  if (gmActions.includes(command.type) && !actor.isGM) return previous;
  const id = actor.isGM ? command.userId : actor.id;
  if (combat && !['end', 'leave', 'remove'].includes(command.type)) return previous;
  const state = readScene(previous, isPlayer);
  const speaker = state.speaker;
  const clear = () => Object.assign(state, { active: false, participants: [], urgent: [], speaker: null });
  const advance = () => {
    state.speaker = waitingOrder(state)[0] ?? null;
    state.urgent = state.urgent.filter(userId => userId !== state.speaker);
  };
  switch (command.type) {
    case 'join':
    case 'urgent': {
      if (!isPlayer(id) || id === state.speaker) return previous;
      if (!state.participants.includes(id)) state.participants.push(id);
      if (command.type === 'urgent') state.urgent = state.urgent.includes(id)
        ? state.urgent.filter(userId => userId !== id) : [...state.urgent, id];
      break;
    }
    case 'leave':
    case 'remove':
      if (!state.participants.includes(id) || (!actor.isGM && state.speaker === id)) return previous;
      state.participants = state.participants.filter(userId => userId !== id);
      state.urgent = state.urgent.filter(userId => userId !== id);
      if (state.speaker === id) { state.speaker = null; advance(); }
      if (!state.participants.length) clear();
      break;
    case 'start':
      state.active = true;
      if (!state.speaker) advance();
      break;
    case 'end': clear(); break;
    case 'choose':
      if (!state.active || !state.participants.includes(id)) return previous;
      state.speaker = id;
      state.urgent = state.urgent.filter(userId => userId !== id);
      break;
    case 'take':
      if (!state.active || state.speaker || waitingOrder(state)[0] !== id) return previous;
      state.speaker = id;
      state.urgent = state.urgent.filter(userId => userId !== id);
      break;
    case 'next':
    case 'finish':
    case 'delay': {
      if (!state.active || (!actor.isGM && state.speaker !== id)) return previous;
      const speaker = state.speaker;
      const next = waitingOrder(state)[0];
      if (command.type === 'delay' && !next) return previous;
      if (command.type !== 'delay' && state.participants.length === 1) { clear(); break; }
      if (speaker) {
        if (command.type === 'delay') {
          const index = state.participants.indexOf(speaker);
          const nextIndex = state.participants.indexOf(next);
          [state.participants[index], state.participants[nextIndex]] = [next, speaker];
        } else state.participants = [...state.participants.filter(userId => userId !== speaker), speaker];
      }
      state.speaker = next ?? null;
      state.urgent = state.urgent.filter(userId => userId !== speaker && userId !== next);
      break;
    }
    default: return previous;
  }
  // A new speaker starts a new turn; the timer keeps no history.
  if (state.speaker !== speaker) state.since = state.speaker ? now : null;
  return JSON.stringify(state) === JSON.stringify(previous) ? previous : state;
}
