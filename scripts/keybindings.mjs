import { waitingOrder } from './scene-state.mjs';

/** Resolve RP shortcuts without depending on toolbar visibility. */
export function shortcutAction(name, { state, user, ready, combat }, repeat = false) {
  if (!ready || !state || !user || repeat) return null;
  const joined = state.participants.includes(user.id);
  const speaking = state.active && state.speaker === user.id;
  switch (name) {
    case 'raise-hand':
      if (user.isGM) return null;
      if (speaking || (combat && !joined)) return 'blocked';
      return joined ? 'leave' : 'join';
    case 'show-xcard':
      if (user.isGM || speaking || (combat && !state.urgent.includes(user.id))) return null;
      return 'urgent';
    case 'hold-on':
      if (user.isGM || speaking || combat) return null;
      return 'hold';
    case 'snatch-spotlight':
      if (user.isGM) return state.active ? 'end' : !combat && state.participants.length ? 'start' : null;
      if (!state.active || !joined || combat) return null;
      if (speaking) return 'finish';
      return !state.speaker && waitingOrder(state)[0] === user.id ? 'take' : null;
    case 'delay-spotlight':
      return !user.isGM && speaking && !combat ? 'delay' : null;
    default: return null;
  }
}

export function registerRpKeybindings(host) {
  const shortcuts = [
    ['raise-hand', 'Raise / lower hand', 'Request or leave the RP queue. Active speakers finish with Space.', 'KeyH', []],
    ['show-xcard', 'Urgent speak', 'Toggle an urgent RP speaking request.', 'KeyX', []],
    ['hold-on', 'Hold on, don\'t go on yet', 'Toggle asking not to change the subject yet. You keep your place in the queue.', 'KeyZ', []],
    ['snatch-spotlight', 'Take / finish spotlight', 'Take the available spotlight or finish speaking. GMs start or end the RP scene.', 'Space', []],
    ['delay-spotlight', 'Delay turn', 'Delay your current speaking turn.', 'Space', ['Shift']]
  ];
  for (const [id, name, hint, key, modifiers] of shortcuts) {
    host.register(id, {
      name: `RP Frame: ${name}`, hint, editable: [{ key, modifiers }], reservedModifiers: [],
      onDown: context => {
        const action = shortcutAction(id, host.context(), context?.event?.repeat);
        if (!action) return false;
        if (action !== 'blocked') void host.command(action);
        return true;
      }
    });
  }
}
