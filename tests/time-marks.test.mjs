import assert from 'node:assert/strict';
import test from 'node:test';
import { TimeMarks, formatMinutes } from '../scripts/time-marks.mjs';
import { emptyScene, readScene, transition } from '../scripts/scene-state.mjs';

const MIN = 60000, every = 10 * MIN;

test('posts each interval once, in order', () => {
  const marks = new TimeMarks();
  assert.equal(marks.check(0, 0, every), null);
  assert.equal(marks.check(0, 9 * MIN, every), null);
  assert.equal(marks.check(0, 10 * MIN, every), 1);
  assert.equal(marks.check(0, 15 * MIN, every), null);
  assert.equal(marks.check(0, 20 * MIN + 500, every), 2);
  assert.equal(marks.check(0, 20 * MIN + 1500, every), null);
});

test('a GM who refreshes or takes over mid-scene does not repeat earlier marks', () => {
  const marks = new TimeMarks();
  assert.equal(marks.check(0, 25 * MIN, every), null);
  assert.equal(marks.check(0, 29 * MIN, every), null);
  assert.equal(marks.check(0, 30 * MIN, every), 3);
});

test('a throttled tab that skips a mark posts only the latest one', () => {
  const marks = new TimeMarks();
  marks.check(0, 0, every);
  assert.equal(marks.check(0, 21 * MIN, every), 2);
});

test('new scene or changed interval starts fresh; off or no scene posts nothing', () => {
  const marks = new TimeMarks();
  marks.check(0, 12 * MIN, every);
  assert.equal(marks.check(100 * MIN, 100 * MIN, every), null);
  assert.equal(marks.check(100 * MIN, 110 * MIN, every), 1);
  assert.equal(marks.check(100 * MIN, 115 * MIN, 5 * MIN), null);
  assert.equal(marks.check(100 * MIN, 120 * MIN, 5 * MIN), 4);
  assert.equal(marks.check(100 * MIN, 200 * MIN, 0), null);
  assert.equal(marks.check(null, 200 * MIN, every), null);
});

test('formatMinutes', () => {
  assert.equal(formatMinutes(10), '10 minutes');
  assert.equal(formatMinutes(1), '1 minute');
  assert.equal(formatMinutes(60), '1 hour');
  assert.equal(formatMinutes(80), '1 hour 20 minutes');
  assert.equal(formatMinutes(120), '2 hours');
});

test('the scene clock starts when the GM starts the scene and clears when it ends', () => {
  const gm = { id: 'gm', isGM: true }, a = { id: 'a', isGM: false };
  let state = transition(emptyScene(), { type: 'join' }, a, { now: 5 });
  assert.equal(state.startedAt, null);
  state = transition(state, { type: 'start' }, gm, { now: 100 });
  assert.equal(state.startedAt, 100);
  state = transition(state, { type: 'urgent' }, a, { now: 200 });
  assert.equal(state.startedAt, 100, 'queue changes keep the clock running');
  assert.equal(readScene(JSON.parse(JSON.stringify(state))).startedAt, 100);
  state = transition(state, { type: 'end' }, gm, { now: 300 });
  assert.equal(state.startedAt, null);
});
