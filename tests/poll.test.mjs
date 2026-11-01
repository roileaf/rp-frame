import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyPolls, readPolls, pollTransition, pollResults, POLL_RULES, MAX_OPTIONS, MAX_POLLS } from '../scripts/poll-state.mjs';
import { SceneController } from '../scripts/scene-controller.mjs';
import { PRESETS, emptyDraft, draftOptions, activePreset, pollView, pollOrder, escapeHtml } from '../scripts/poll-app.mjs';

const gm = { id: 'gm', isGM: true }, a = { id: 'a', isGM: false }, b = { id: 'b', isGM: false }, c = { id: 'c', isGM: false };
const run = (state, actor, type, data = {}, now = 1000) => pollTransition(state, { type, ...data }, actor, { now });
const ask = (state, actor, data, now) => run(state, actor, 'ask', data, now);
const last = state => state.polls.at(-1);
const choice = () => ask(emptyPolls(), a, { question: ' Camp  where? ', options: ['Cave', 'Inn', 'cave ', 'Inn'] });

test('player asks a choice poll; whitespace and duplicate choices cleaned', () => {
  const poll = last(choice());
  assert.equal(poll.question, 'Camp where?');
  assert.deepEqual(poll.options, ['Cave', 'Inn', 'cave']);
  assert.equal(poll.askerId, 'a');
  assert.equal(poll.open, true);
  assert.equal(poll.id, 1000);
});

test('fewer than two choices makes a free-text poll; choices capped', () => {
  assert.deepEqual(last(ask(emptyPolls(), a, { question: 'Why?', options: ['only'] })).options, []);
  const many = Array.from({ length: 12 }, (_, i) => `o${i}`);
  assert.equal(last(ask(emptyPolls(), a, { question: 'Q', options: many })).options.length, MAX_OPTIONS);
});

test('several polls can be open at once, from anyone; empty question rejected', () => {
  const none = emptyPolls();
  assert.equal(ask(none, a, { question: '   ' }), none);
  let state = choice();
  state = ask(state, b, { question: 'Second?' }, 1000);
  state = ask(state, gm, { question: 'Third?' }, 5);
  assert.deepEqual(state.polls.map(poll => [poll.askerId, poll.open]), [['a', true], ['b', true], ['gm', true]]);
  assert.deepEqual(state.polls.map(poll => poll.id), [1000, 1001, 1002], 'IDs stay unique even if the clock is behind');
});

test('IDs never repeat after a removal', () => {
  let state = choice();
  state = run(state, a, 'clear', { pollId: 1000 });
  assert.equal(state.lastId, 1000);
  assert.equal(last(ask(state, a, { question: 'Again' }, 1000)).id, 1001);
});

test('past the cap the oldest closed poll is dropped; with all open, asking is refused', () => {
  let state = emptyPolls();
  for (let i = 0; i < MAX_POLLS; i++) state = ask(state, a, { question: `Q${i}` }, i + 1);
  const full = state;
  assert.equal(ask(full, a, { question: 'One more' }), full);
  state = run(full, a, 'close', { pollId: 3 });
  state = ask(state, a, { question: 'One more' }, 100);
  assert.equal(state.polls.length, MAX_POLLS);
  assert.equal(state.polls.some(poll => poll.id === 3), false);
  assert.equal(last(state).question, 'One more');
});

test('answers go to the named poll; one per player, changeable; invalid or unknown polls rejected', () => {
  let state = ask(choice(), b, { question: 'Other?', options: ['x', 'y'] }, 2000);
  const answer = (actor, value, pollId = 1000) => run(state, actor, 'answer', { pollId, value });
  assert.equal(answer(b, 5), state);
  assert.equal(answer(b, '1'), state);
  assert.equal(answer(b, 1, 999), state);
  state = answer(b, 1);
  state = answer(a, 0);
  state = answer(b, 0);
  state = answer(a, 1, 2000);
  assert.deepEqual(state.polls.map(poll => poll.answers), [{ a: 0, b: 0 }, { a: 1 }]);
  assert.equal(answer(b, 0), state);
  state = run(state, gm, 'close', { pollId: 1000 });
  assert.equal(answer(c, 1), state);
});

test('free-text answers trimmed; empty rejected', () => {
  let state = ask(emptyPolls(), a, { question: 'Favorite NPC?' });
  assert.equal(run(state, b, 'answer', { pollId: 1000, value: '  ' }), state);
  state = run(state, b, 'answer', { pollId: 1000, value: '  the  innkeeper ' });
  assert.deepEqual(last(state).answers, { b: 'the innkeeper' });
});

test('close and remove one poll: its asker or a GM only; other polls untouched', () => {
  let state = ask(choice(), b, { question: 'Other?' }, 2000);
  assert.equal(run(state, b, 'close', { pollId: 1000 }), state);
  assert.equal(run(state, b, 'clear', { pollId: 1000 }), state);
  state = run(state, a, 'close', { pollId: 1000 });
  assert.deepEqual(state.polls.map(poll => poll.open), [false, true]);
  state = run(state, gm, 'clear', { pollId: 1000 });
  assert.deepEqual(state.polls.map(poll => poll.question), ['Other?']);
  assert.equal(run(state, gm, 'clear', { pollId: 1000 }), state);
});

test('GMs never answer; they see results and no answer controls', () => {
  const state = choice();
  assert.equal(run(state, gm, 'answer', { pollId: 1000, value: 0 }), state);
  const view = pollView(last(state), { userId: 'gm', isGM: true, users: new Map(), voters: 2 });
  assert.equal(view.canAnswer, false);
  assert.equal(view.showResults, true);
  assert.equal(pollView(last(state), { userId: 'b', users: new Map() }).canAnswer, true);
});

test('readPolls drops unknown users, invalid answers, broken and duplicate polls', () => {
  const poll = { ...last(choice()), answers: { a: 0, b: 9, ghost: 1, gm: 'x' } };
  const state = readPolls({ version: 2, revision: 7, lastId: 5, polls: [poll, { ...poll, question: 'dup' }, { question: 'no id', askerId: 'a' }, null] }, id => id !== 'ghost');
  assert.equal(state.polls.length, 1);
  assert.deepEqual(state.polls[0].answers, { a: 0 });
  assert.equal(state.lastId, 1000);
  assert.equal(state.revision, 7);
  assert.deepEqual(readPolls({ version: 1, question: 'old' }), emptyPolls());
  assert.deepEqual(readPolls(null), emptyPolls());
});

test('results: counts, voters, and anonymous hides who', () => {
  let state = choice();
  for (const [actor, value] of [[a, 1], [b, 1], [c, 0]]) state = run(state, actor, 'answer', { pollId: 1000, value });
  const results = pollResults(last(state));
  assert.equal(results.total, 3);
  assert.deepEqual(results.options.map(o => [o.label, o.count, o.voters]), [['Cave', 1, ['c']], ['Inn', 2, ['a', 'b']], ['cave', 0, []]]);
  assert.deepEqual(pollResults({ ...last(state), anonymous: true }).options[1].voters, []);
  const text = { ...last(ask(emptyPolls(), a, { question: 'Why?' })), anonymous: true, answers: { a: 'zeta', b: 'alpha' } };
  assert.deepEqual(pollResults(text).texts, [{ userId: null, text: 'alpha' }, { userId: null, text: 'zeta' }]);
});

test('poll view hides results until you answer; owner and closed polls show them', () => {
  const users = new Map([['a', { name: 'Ana' }]]);
  const state = choice();
  assert.equal(pollView(null, { userId: 'b', users }), null);
  assert.equal(pollView(last(state), { userId: 'b', users, voters: 3 }).showResults, false);
  assert.equal(pollView(last(state), { userId: 'a', users }).showResults, true);
  const view = pollView(last(run(state, b, 'answer', { pollId: 1000, value: 0 })), { userId: 'b', users, voters: 3 });
  assert.equal(view.showResults, true);
  assert.equal(view.mine, 0);
  assert.equal(view.asker, 'Ana');
  assert.equal(`${view.answered}/${view.expected}`, '1/3');
});

test('window lists open polls first, newest first', () => {
  const polls = [{ id: 1, open: true }, { id: 2, open: false }, { id: 3, open: true }, { id: 4, open: false }];
  assert.deepEqual(pollOrder(polls).map(poll => poll.id), [3, 1, 4, 2]);
});

test('ask form helpers', () => {
  const draft = { ...emptyDraft(), choices: [' Yes ', '', 'No'] };
  assert.deepEqual(draftOptions(draft), ['Yes', 'No']);
  assert.equal(activePreset(draft), null);
  assert.equal(activePreset({ ...draft, choices: [' Yes', 'No '] }), 'yes-no');
  assert.equal(activePreset({ ...draft, choices: ['1', '2', '3', '4', '5'] }), 'scale');
  assert.deepEqual(draftOptions({ ...draft, freeText: true }), []);
  assert.equal(activePreset({ ...draft, freeText: true }), 'text');
  assert.deepEqual(PRESETS.map(preset => preset.label), ['Yes / No', 'Yes / No / Maybe', 'Ready / Not yet', '1–5', 'Free answer']);
  assert.equal(escapeHtml('<b a="1">&\''), '&lt;b a=&quot;1&quot;&gt;&amp;&#39;');
});

test('polls reuse the GM controller: persisted before publish; players apply removals, ignore stale snapshots', async () => {
  let stored = {};
  const events = [];
  let clock = 100;
  const controller = new SceneController({
    isAuthority: () => true, isPlayer: () => true, inCombat: () => false, now: () => clock++,
    load: async () => stored, save: async data => { stored = structuredClone(data); events.push('save'); },
    changed: () => events.push('changed'), publish: () => events.push('publish'), error: error => { throw error; }
  }, POLL_RULES);
  await controller.initialize();
  events.length = 0;
  assert.equal(await controller.enqueue({ type: 'ask', question: 'Q?', options: ['x', 'y'] }, b), true);
  const id = controller.state.polls[0].id;
  assert.equal(await controller.enqueue({ type: 'answer', pollId: id, value: 1 }, a), true);
  assert.deepEqual(events, ['save', 'changed', 'publish', 'save', 'changed', 'publish']);
  assert.deepEqual(stored.polls[0].answers, { a: 1 });
  const player = new SceneController({ isAuthority: () => false, isPlayer: () => true, now: () => 0, load: async () => ({}), changed: () => {}, publish: () => {} }, POLL_RULES);
  assert.equal(player.accept(structuredClone(stored)), true);
  await controller.enqueue({ type: 'clear', pollId: id }, b);
  assert.equal(player.accept({ ...stored, polls: [] }), true);
  assert.deepEqual(player.state.polls, []);
  assert.equal(player.accept({ ...stored, revision: 0, polls: [{ id: 9, question: 'old', askerId: 'a' }] }), false);
});
