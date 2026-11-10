import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyScene, readScene, transition, waitingOrder } from '../scripts/scene-state.mjs';
import { scenePresentation } from '../scripts/view.mjs';

const gm = { id: 'gm', isGM: true };
const player = id => ({ id, isGM: false });
const step = (state, actor, type, userId) => transition(state, { type, userId }, actor);

function queue() {
  let state = emptyScene();
  for (const id of ['a', 'b', 'c', 'd']) state = step(state, player(id), 'join');
  return step(state, gm, 'start');
}

test('hold on keeps your place; urgent jumps ahead', () => {
  let state = step(queue(), player('d'), 'hold');
  assert.deepEqual(state.hold, ['d']);
  assert.deepEqual(waitingOrder(state), ['b', 'c', 'd']);
  state = step(state, player('c'), 'urgent');
  assert.deepEqual(waitingOrder(state), ['c', 'b', 'd']);
});

test('hold and urgent are exclusive: each clears the other; toggling again lowers it', () => {
  let state = step(queue(), player('b'), 'urgent');
  state = step(state, player('b'), 'hold');
  assert.deepEqual([state.urgent, state.hold], [[], ['b']]);
  state = step(state, player('b'), 'urgent');
  assert.deepEqual([state.urgent, state.hold], [['b'], []]);
  state = step(state, player('b'), 'urgent');
  state = step(state, player('b'), 'hold');
  state = step(state, player('b'), 'hold');
  assert.deepEqual(state.hold, []);
});

test('hold joins the queue if needed; the speaker cannot hold', () => {
  let state = step(emptyScene(), player('a'), 'hold');
  assert.deepEqual([state.participants, state.hold], [['a'], ['a']]);
  state = step(queue(), player('a'), 'hold');
  assert.deepEqual(state.hold, []);
});

test('a hold drops when that player speaks, leaves or the scene ends', () => {
  let state = step(step(queue(), player('b'), 'hold'), player('c'), 'hold');
  state = step(state, player('a'), 'finish');
  assert.equal(state.speaker, 'b');
  assert.deepEqual(state.hold, ['c']);
  state = step(state, player('c'), 'leave');
  assert.deepEqual(state.hold, []);
  state = step(step(state, player('d'), 'hold'), gm, 'end');
  assert.deepEqual(state.hold, []);
});

test('readScene keeps valid holds only; older saves without holds read as none', () => {
  const state = queue();
  assert.deepEqual(readScene({ ...state, hold: ['b', 'a', 'ghost', 'b'] }).hold, ['b']);
  assert.deepEqual(readScene({ ...state, urgent: ['c'], hold: ['c'] }).hold, []);
  const { hold, ...old } = state;
  assert.deepEqual(readScene(old).hold, []);
});

test('banner queue marks holding players without moving them', () => {
  const users = new Map(['a', 'b', 'c', 'd'].map(id => [id, { id, name: id.toUpperCase() }]));
  const state = step(queue(), player('c'), 'hold');
  const items = scenePresentation(state, { users, userId: 'gm', isGM: true, connected: true }).queue;
  assert.deepEqual(items.map(item => [item.id, item.position, item.hold]), [['b', 1, false], ['c', 2, true], ['d', 3, false]]);
});
