import assert from 'node:assert/strict';
import test from 'node:test';
import { registerRpKeybindings, shortcutAction } from '../scripts/keybindings.mjs';
import { emptyScene, transition } from '../scripts/scene-state.mjs';

function fixture() {
  const bindings = new Map(), sent = [];
  const host = { state: emptyScene(), user: { id: 'a', isGM: false }, ready: true, combat: false };
  registerRpKeybindings({
    register: (id, data) => bindings.set(id, data), context: () => host,
    command: type => { sent.push(type); host.state = transition(host.state, { type }, host.user); }
  });
  return { host, bindings, sent, press: (id, repeat = false) => bindings.get(id).onDown({ event: { repeat } }) };
}

test('original H/X/Space/Shift+Space defaults plus Z for hold on are editable with exact modifiers', () => {
  const { bindings } = fixture();
  assert.deepEqual([...bindings].map(([id, data]) => [id, data.editable]), [
    ['raise-hand', [{ key: 'KeyH', modifiers: [] }]],
    ['show-xcard', [{ key: 'KeyX', modifiers: [] }]],
    ['hold-on', [{ key: 'KeyZ', modifiers: [] }]],
    ['snatch-spotlight', [{ key: 'Space', modifiers: [] }]],
    ['delay-spotlight', [{ key: 'Space', modifiers: ['Shift'] }]]
  ]);
});

test('H requests/leaves queue; X requests/cancels urgent; H cannot remove speaker', () => {
  const { host, press, sent } = fixture();
  assert.equal(press('raise-hand'), true);
  assert.deepEqual(host.state.participants, ['a']);
  press('raise-hand');
  assert.deepEqual(host.state.participants, []);
  press('show-xcard');
  assert.deepEqual(host.state.participants, ['a']);
  assert.deepEqual(host.state.urgent, ['a']);
  press('show-xcard');
  assert.deepEqual(host.state.urgent, []);
  host.state = transition(host.state, { type: 'start' }, { id: 'gm', isGM: true });
  const count = sent.length;
  assert.equal(press('raise-hand'), true);
  assert.equal(press('show-xcard'), false);
  assert.equal(sent.length, count);
  assert.equal(host.state.speaker, 'a');
});

test('GM Space approves pending scene and ends it; idle Space and player keys do nothing', () => {
  const { host, press } = fixture();
  press('raise-hand');
  host.user = { id: 'gm', isGM: true };
  assert.equal(press('snatch-spotlight'), true);
  assert.equal(host.state.active, true);
  assert.equal(host.state.speaker, 'a');
  assert.equal(press('raise-hand'), false);
  assert.equal(press('show-xcard'), false);
  assert.equal(press('delay-spotlight'), false);
  press('snatch-spotlight');
  assert.equal(host.state.active, false);
  assert.deepEqual(host.state.participants, []);
  assert.equal(press('snatch-spotlight'), false);
});

test('player Space takes available spotlight and finishes; Shift+Space delays without leaving', () => {
  const { host, press } = fixture();
  host.state = { ...emptyScene(), active: true, participants: ['a', 'b'] };
  assert.equal(press('snatch-spotlight'), true);
  assert.equal(host.state.speaker, 'a');
  assert.equal(press('delay-spotlight'), true);
  assert.equal(host.state.speaker, 'b');
  assert.deepEqual(host.state.participants, ['b', 'a']);
  assert.equal(press('snatch-spotlight'), false);
  host.user.id = 'b';
  assert.equal(press('snatch-spotlight'), true);
  assert.equal(host.state.speaker, 'a');
  assert.deepEqual(host.state.participants, ['a', 'b']);
  host.state = { ...emptyScene(), active: true, speaker: 'b', participants: ['b'] };
  press('snatch-spotlight');
  assert.equal(host.state.active, false);
});

test('held shortcuts dispatch once; startup/combat/role guards reject invalid actions', () => {
  const { host, press, sent } = fixture();
  for (const id of ['raise-hand', 'show-xcard', 'snatch-spotlight', 'delay-spotlight']) assert.equal(press(id, true), false);
  assert.equal(sent.length, 0);
  host.ready = false;
  assert.equal(press('raise-hand'), false);
  host.ready = true;
  host.combat = true;
  assert.equal(press('raise-hand'), true);
  assert.equal(sent.length, 0);
  assert.equal(press('show-xcard'), false);
  assert.equal(press('snatch-spotlight'), false);
  assert.equal(shortcutAction('unknown', host), null);
});

test('Z toggles hold on, which clears urgent; not for the speaker, GMs or during combat', () => {
  const { host, press } = fixture();
  assert.equal(press('show-xcard'), true);
  assert.equal(press('hold-on'), true);
  assert.deepEqual([host.state.hold, host.state.urgent], [['a'], []]);
  press('hold-on');
  assert.deepEqual(host.state.hold, []);
  host.combat = true;
  assert.equal(press('hold-on'), false);
  host.combat = false;
  host.state = transition(host.state, { type: 'start' }, { id: 'gm', isGM: true });
  assert.equal(press('hold-on'), false);
  host.user = { id: 'gm', isGM: true };
  assert.equal(press('hold-on'), false);
});
