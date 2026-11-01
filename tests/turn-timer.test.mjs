import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyScene, readScene, transition } from '../scripts/scene-state.mjs';
import { scenePresentation, formatDuration } from '../scripts/view.mjs';

const gm = { id: 'gm', isGM: true };
const player = id => ({ id, isGM: false });
const step = (state, actor, type, now, userId) => transition(state, { type, userId }, actor, { now });

function scene() {
  let state = emptyScene();
  state = step(state, player('a'), 'join', 1);
  state = step(state, player('b'), 'join', 2);
  return step(state, gm, 'start', 100);
}

test('a turn starts when a speaker gets the spotlight and restarts on every new speaker', () => {
  let state = scene();
  assert.equal(state.speaker, 'a');
  assert.equal(state.since, 100);
  state = step(state, player('b'), 'urgent', 150);
  assert.equal(state.since, 100, 'queue changes keep the current turn running');
  state = step(state, player('a'), 'finish', 200);
  assert.deepEqual([state.speaker, state.since], ['b', 200]);
  state = step(state, gm, 'choose', 300, 'a');
  assert.deepEqual([state.speaker, state.since], ['a', 300]);
  state = step(state, player('a'), 'delay', 400);
  assert.deepEqual([state.speaker, state.since], ['b', 400]);
  state = step(state, gm, 'end', 500);
  assert.equal(state.since, null);
});

test('no turn time without a speaker; persisted turn start survives reading', () => {
  assert.equal(emptyScene().since, null);
  const state = scene();
  assert.equal(readScene(JSON.parse(JSON.stringify(state))).since, 100);
  assert.equal(readScene({ ...state, since: 'soon' }).since, null);
  assert.equal(readScene({ ...state, active: false }).since, null);
});

test('banner carries the turn start only while someone speaks', () => {
  const users = new Map([['a', { id: 'a', name: 'Ana' }], ['b', { id: 'b', name: 'Ben' }]]);
  const state = scene();
  assert.equal(scenePresentation(state, { users, userId: 'gm', isGM: true, connected: true }).since, 100);
  const waiting = { ...state, active: false, speaker: null, since: null };
  assert.equal(scenePresentation(waiting, { users, userId: 'gm', isGM: true, connected: true }).since, null);
});

test('formatDuration', () => {
  assert.equal(formatDuration(-5), '0:00');
  assert.equal(formatDuration(42_999), '0:42');
  assert.equal(formatDuration(185_000), '3:05');
  assert.equal(formatDuration(3_729_000), '1:02:09');
});
