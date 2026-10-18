import { SceneController } from './scripts/scene-controller.mjs';
import { GmConnection } from './scripts/gm-connection.mjs';
import { SceneView } from './scripts/view.mjs';
import { StoryframeLink } from './scripts/storyframe-link.mjs';
import { registerRpKeybindings } from './scripts/keybindings.mjs';
import { SpeakerHighlight, createPixiRing, drawPixiRing } from './scripts/speaker-highlight.mjs';
import { applyFrame, canEditFrame, getFrame } from './scripts/avatar-frame.mjs';
import { openFrameEditor } from './scripts/avatar-frame-app.mjs';
import { DEFAULT_THRESHOLD_DB } from './scripts/voice-detector.mjs';
import { VoiceRoster } from './scripts/voice-roster.mjs';
import { browserVoiceMic } from './scripts/voice-mic.mjs';
import { VoiceService } from './scripts/voice-service.mjs';
import { VoiceGlow, createPixiGlow, drawPixiGlow, fadeGlow, applyVoiceCameras, voiceGlowIds, glowStyle, normalizeAppearances, DEFAULT_APPEARANCES } from './scripts/voice-glow.mjs';
import { voiceSettingsApp, refreshVoiceSettings, refreshVoiceMeter } from './scripts/voice-settings-app.mjs';
import { PushToTalk, PTT_MOUSE } from './scripts/voice-ptt.mjs';

export const MODULE_ID = 'rp-frame';
let socket, controller, connection, view, spotlight, highlight, pollTimer, voice, voiceGlow, appearances = normalizeAppearances();
const roster = new VoiceRoster();
const session = Date.now() + Math.random();
let initialized = false;
const isAuthority = () => game.user?.isGM && game.users.activeGM?.id === game.user.id;
const isPlayer = id => Boolean(game.users.get(id) && !game.users.get(id).isGM);
const inCombat = () => game.combats?.some(combat => combat.active && combat.started) ?? false;
const connected = () => isAuthority() ? Boolean(controller?.ready) : Boolean(connection?.connected);
const report = error => { console.error('RP Frame |', error); ui.notifications?.error(`RP Frame: ${error.message}`); };
const setting = key => game.settings.get(MODULE_ID, key);
const sender = context => context?.socketdata?.userId;
const updateVoice = () => voice?.update().catch(report);
const CONSENT_HTML = '<p>Your GM turned on voice glow: your character\'s token glows while you talk.</p><p>Foundry will listen to your mic\'s <strong>volume level only</strong>. Nothing is recorded or sent; only "talking / not talking" is shared.</p>';
const packet = () => ({ session, ready: Boolean(controller?.ready && isAuthority()), state: controller?.state });
// Push-to-talk: with voicePtt on, voice glow needs the talk key or mouse button held as well as speech.
const ptt = new PushToTalk({ onChange: () => { voice?.refreshGate(); refreshVoiceMeter(); } });
// DOM events can arrive before init registers the setting.
const pttOn = () => { try { return Boolean(setting('voicePtt')); } catch { return false; } };
const voiceGate = () => !pttOn() || ptt.held;

/** Apply saved portrait framing to camera tiles and add the align button where allowed. */
function decorateCameras() {
  for (const tile of document.querySelectorAll?.('.camera-view[data-user]') ?? []) {
    const user = game.users?.get(tile.dataset.user);
    if (!user) continue;
    const img = tile.querySelector('img.user-avatar');
    if (img) applyFrame(img, getFrame(user));
    // Own corner button: Foundry's left control bar is already full on small tiles and clips extras.
    if (tile.querySelector(':scope > .rp-frame-avatar-btn') || !canEditFrame(game.user, user)) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ui-control icon fa-solid fa-fw fa-crop-simple rp-frame-avatar-btn';
    button.dataset.tooltip = 'Align camera portrait';
    button.setAttribute('aria-label', 'Align camera portrait');
    button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); openFrameEditor(user); });
    tile.append(button);
  }
}

/** Glow talking players' tokens and cameras (remote roster plus this client's own detector). */
function renderVoice() {
  if (!voiceGlow) return;
  const shown = setting('voiceGlow') && setting('voiceShow');
  const talkingIds = shown ? roster.talkingIds() : new Set();
  if (shown && voice?.talking) talkingIds.add(game.user.id);
  const state = controller?.state;
  voiceGlow.sync({ talkingIds, state });
  if (typeof document.querySelectorAll !== 'function') return;
  const cameraIds = setting('voiceShowCamera') ? voiceGlowIds(talkingIds, state) : new Set();
  applyVoiceCameras(document, cameraIds, game.user.isGM && setting('voiceGlow') ? roster.noMicIds() : null);
}

/** Fade a glow out, then remove it; the token or glow may be destroyed meanwhile. */
function detachGlow(token, glow) {
  if (glow.destroyed) return;
  fadeGlow(glow, 1, 0, 150, () => {
    if (!token.destroyed) token.removeChild?.(glow);
    if (!glow.destroyed) glow.destroy();
  });
}

/** Show voice glow appearances ({ token, camera }) on this screen: camera halo CSS var plus token glow redraw. */
function applyAppearance(value) {
  appearances = normalizeAppearances(value);
  globalThis.document?.documentElement?.style?.setProperty?.('--rp-frame-voice-shadow', glowStyle(appearances.camera).cameraShadow);
  voiceGlow?.redrawAll();
}

function createGlow() {
  const glow = createPixiGlow();
  glow.alpha = 0;
  fadeGlow(glow, 0, 1, 150);
  return glow;
}

function refresh() {
  decorateCameras();
  if (!controller) return;
  view?.render(controller.state);
  highlight?.sync(controller.state);
  renderVoice();
  void ui.controls?.render?.({ reset: true });
}

function changed(state) {
  refresh();
  if (isAuthority()) void spotlight?.sync(state);
  Hooks.callAll('rpFrameStateChanged', structuredClone(state));
}

export function registerSettings() {
  const register = (key, data) => game.settings.register(MODULE_ID, key, data);
  register('scene', { scope: 'world', config: false, type: Object, default: {} });
  register('spotlightLink', { scope: 'world', config: false, type: Object, default: {} });
  register('layout', { scope: 'client', config: false, type: Object, default: {} });
  register('banner', { name: 'RP Frame: speaker banner', hint: 'Show the active speaker and queue. Drag to move, use the corner to resize.', scope: 'client', config: true, type: Boolean, default: true, onChange: refresh });
  register('badges', { name: 'RP Frame: player and camera badges', scope: 'client', config: true, type: Boolean, default: true, onChange: refresh });
  register('tokenHighlight', { name: 'RP Frame: highlight speaker token', hint: 'Draw a green ring around the speaking player\'s character tokens.', scope: 'client', config: true, type: Boolean, default: true, onChange: refresh });
  register('linkSpotlight', { name: 'RP Frame: follow StoryFrame spotlight', hint: 'When optional StoryFrame is enabled, highlight existing speakers matching each player character. Restore the previous spotlight when the RP scene ends.', scope: 'world', config: true, type: Boolean, default: true, onChange: () => { if (controller) void spotlight?.sync(controller.state); } });
  register('stopForCombat', { name: 'RP Frame: end scene when combat starts', scope: 'world', config: true, type: Boolean, default: true });
  register('voiceGlow', { name: 'RP Frame: voice glow', hint: 'Players\' character tokens and camera tiles glow while they talk. Each player\'s browser measures their own mic level; no audio is sent or recorded.', scope: 'world', config: false, type: Boolean, default: false, onChange: () => { updateVoice(); renderVoice(); refreshVoiceSettings(); } });
  register('voiceOptOut', { name: 'RP Frame: don\'t use my mic for voice glow', scope: 'client', config: false, type: Boolean, default: false, onChange: () => { updateVoice(); refreshVoiceSettings(); } });
  register('voiceShow', { name: 'RP Frame: show voice glow', scope: 'client', config: false, type: Boolean, default: true, onChange: () => { renderVoice(); refreshVoiceSettings(); } });
  register('voiceShowToken', { name: 'RP Frame: show token voice glow', scope: 'client', config: false, type: Boolean, default: true, onChange: () => { renderVoice(); refreshVoiceSettings(); } });
  register('voiceShowCamera', { name: 'RP Frame: show camera voice glow', scope: 'client', config: false, type: Boolean, default: true, onChange: () => { renderVoice(); refreshVoiceSettings(); } });
  register('voiceConsent', { scope: 'client', config: false, type: Boolean, default: false });
  register('voiceThreshold', { scope: 'client', config: false, type: Number, default: DEFAULT_THRESHOLD_DB });
  register('voiceAppearance', { scope: 'client', config: false, type: Object, default: structuredClone(DEFAULT_APPEARANCES), onChange: applyAppearance });
  register('voicePtt', { scope: 'client', config: false, type: Boolean, default: false, onChange: () => { voice?.refreshGate(); refreshVoiceSettings(); } });
  register('voicePttMouse', { scope: 'client', config: false, type: String, default: 'none', onChange: value => { ptt.mouse = value; refreshVoiceSettings(); } });
  ptt.mouse = setting('voicePttMouse');
  const voiceApp = voiceSettingsApp({ onAppearance: applyAppearance, gate: voiceGate });
  if (voiceApp) game.settings.registerMenu(MODULE_ID, 'voiceSettings', { name: 'RP Frame: voice glow', label: 'Open', hint: 'Turn voice glow on for the table (GM), set up your mic, and choose how the glow looks on your screen.', icon: 'fa-solid fa-microphone-lines', restricted: false, type: voiceApp });
  applyAppearance(setting('voiceAppearance'));
}

export function registerKeybindings() {
  registerRpKeybindings({
    register: (id, data) => game.keybindings.register(MODULE_ID, id, data),
    context: () => ({ state: controller?.state, user: game.user, ready: controller?.ready, combat: setting('stopForCombat') && inCombat() }),
    command
  });
  // No default key: players pick the same one as their voice app. Returning false leaves the key unconsumed.
  game.keybindings.register(MODULE_ID, 'voicePushToTalk', {
    name: 'RP Frame: push-to-talk',
    hint: 'Hold while talking when voice glow push-to-talk is on. Use the same key as your voice app.',
    editable: [], repeat: false,
    onDown: () => { ptt.keyDown(); return false; },
    onUp: () => { ptt.keyUp(); return false; }
  });
}

export function registerSocket() {
  if (socket) return;
  socket = socketlib.registerModule(MODULE_ID);
  socket.register('command', async function(command, expectedSession) {
    if (!isAuthority() || !controller?.ready || expectedSession !== session) return;
    const actor = game.users.get(sender(this));
    if (actor) {
      // socketlib commands do not await handlers; contain rejected writes here.
      try { await controller.enqueue(command, { id: actor.id, isGM: actor.isGM }); }
      catch (error) { report(error); }
    }
  });
  socket.register('state', function(data) {
    const from = sender(this);
    if (!isAuthority() && controller && connection?.accept(from, data, game.users.activeGM?.id)) controller.accept(data.state);
  });
  socket.register('ping', async function(nonce) {
    if (!isAuthority() || !controller?.ready) return;
    // A GM elected after another disconnects must first recover durable state.
    if (!controller.authority) {
      try { await controller.initialize(); }
      catch (error) { report(error); return; }
      if (!isAuthority()) return;
    }
    const requester = sender(this);
    if (requester) socket.executeForUsers('pong', [requester], nonce, packet());
  });
  socket.register('pong', function(nonce, data) {
    if (connection?.accept(sender(this), data, game.users.activeGM?.id, nonce)) controller?.accept(data.state);
  });
  // Only {talking, mic} ever arrives here; socketlib authenticates the sender, not the payload.
  socket.register('voice', function(payload) {
    const from = sender(this);
    if (from && game.users.get(from) && roster.update(from, payload, Date.now())) renderVoice();
  });
  // A newcomer's userConnected fires elsewhere before its handlers exist; it asks for statuses once ready.
  socket.register('voiceHello', function() {
    if (setting('voiceGlow')) voice?.announce();
  });
  socket.register('unavailable', function(previousSession) {
    connection?.unavailable(sender(this), previousSession);
    connection?.poll(game.users.activeGM?.id, true);
  });
  if (game.ready) void initialize();
}

export async function command(type, userId = null) {
  if (!controller?.ready) return;
  if (isAuthority()) {
    try { return await controller.enqueue({ type, userId }, { id: game.user.id, isGM: true }); }
    catch (error) { report(error); return false; }
  }
  if (!connected()) { ui.notifications?.warn('Waiting for GM'); return false; }
  socket.executeForAllGMs('command', { type, userId }, connection?.session);
  return true;
}

export async function initialize() {
  if (initialized || !socket || !game.ready) return;
  initialized = true;
  spotlight = new StoryframeLink({
    isAuthority, enabled: () => Boolean(game.modules.get('storyframe')?.active && setting('linkSpotlight')),
    manager: () => game.modules.get('storyframe')?.active ? game.storyframe?.stateManager : null,
    sceneId: () => game.scenes.current?.id, user: id => game.users.get(id),
    load: () => setting('spotlightLink'), save: data => game.settings.set(MODULE_ID, 'spotlightLink', data),
    render: () => { game.storyframe?.gmSidebar?.render(); game.storyframe?.playerViewer?.render(); }, error: report
  });
  connection = new GmConnection({
    sendPing: (_gm, nonce) => socket.executeForAllGMs('ping', nonce), changed: refresh
  });
  view = new SceneView({
    context: () => ({ users: game.users, userId: game.user.id, isGM: game.user.isGM, connected: connected() }),
    command, showBanner: () => setting('banner'), showBadges: () => setting('badges'),
    layout: () => setting('layout'), saveLayout: data => game.settings.set(MODULE_ID, 'layout', data)
  });
  highlight = new SpeakerHighlight({
    tokens: () => globalThis.canvas?.tokens?.placeables ?? [], users: () => game.users,
    enabled: () => setting('tokenHighlight'), createRing: createPixiRing, drawRing: drawPixiRing
  });
  voiceGlow = new VoiceGlow({
    tokens: () => globalThis.canvas?.tokens?.placeables ?? [], users: () => game.users,
    enabled: () => setting('voiceGlow') && setting('voiceShow') && setting('voiceShowToken'),
    createRing: createGlow, drawRing: (glow, token) => drawPixiGlow(glow, token, appearances.token), detachRing: detachGlow
  });
  voice = new VoiceService({
    enabled: () => setting('voiceGlow'), optedOut: () => setting('voiceOptOut'), consented: () => setting('voiceConsent'),
    askConsent: async () => Boolean(await foundry.applications.api.DialogV2.confirm({
      window: { title: 'Voice glow' }, content: CONSENT_HTML,
      yes: { label: 'Allow' }, no: { label: 'No thanks' }, rejectClose: false
    })),
    setOptOut: value => game.settings.set(MODULE_ID, 'voiceOptOut', value),
    setConsent: () => game.settings.set(MODULE_ID, 'voiceConsent', true),
    threshold: () => setting('voiceThreshold'), gate: voiceGate, mic: browserVoiceMic(),
    // Local transitions re-render so the speaker sees their own glow.
    send: payload => { socket.executeForOthers('voice', payload); renderVoice(); },
    now: () => Date.now(), setInterval: (fn, ms) => globalThis.setInterval(fn, ms), clearInterval: id => globalThis.clearInterval(id)
  });
  // Browsers may start the AudioContext suspended until the first user gesture.
  for (const type of ['pointerdown', 'keydown']) document.addEventListener?.(type, () => voice.mic.resume(), { once: true, capture: true });
  controller = new SceneController({
    isAuthority, isPlayer, inCombat: () => setting('stopForCombat') && inCombat(), now: () => Date.now(),
    load: () => setting('scene'), save: data => game.settings.set(MODULE_ID, 'scene', data),
    changed, publish: () => socket.executeForOthers('state', packet()), error: report
  });
  try { await controller.initialize(); }
  catch (error) { initialized = false; report(error); return; }
  const api = game.modules.get(MODULE_ID).api = {
    getState: () => structuredClone(controller.state), isGmConnected: connected,
    command, start: () => command('start'), end: () => command('end'),
    join: () => command('join'), finish: () => command('finish'), urgent: () => command('urgent')
  };
  if (game.modules.get('storyframe')?.active && game.storyframe) game.storyframe.rpFrame = api;
  const poll = () => {
    if (roster.prune(Date.now())) renderVoice();
    if (!isAuthority()) {
      controller.authority = false;
      connection.poll(game.users.activeGM?.id);
    } else if (!controller.authority) void controller.initialize().catch(report);
    else if (controller.state.active) void spotlight.sync(controller.state);
  };
  poll();
  pollTimer = globalThis.setInterval(poll, 1000);
  // Warn once; do not alter another module's settings.
  if (game.user.isGM && game.modules.get('raise-my-hand')?.active && game.settings.get('raise-my-hand', 'enableQueue')) {
    ui.notifications.warn('RP Frame: disable Raise My Hand\'s queue to avoid two RP scene systems.');
  }
  refresh();
  updateVoice();
  socket.executeForOthers('voiceHello');
}

export function tokenControls(controls) {
  const tokens = Array.isArray(controls) ? controls.find(control => control.name === 'token') : controls.tokens;
  if (!tokens) return;
  const state = controller?.state;
  const tools = [];
  if (game.user.isGM) tools.push({ name: 'rp-frame-scene', title: state?.active ? 'RP Frame — end scene' : 'RP Frame — start scene', icon: state?.active ? 'fas fa-stop' : 'fas fa-play', visible: Boolean(state?.active || state?.participants.length), onClick: () => command(state?.active ? 'end' : 'start') });
  else {
    const speaking = state?.speaker === game.user.id;
    const joined = state?.participants.includes(game.user.id);
    tools.push({ name: 'rp-frame-join', title: speaking ? 'RP Frame — finish speaking' : joined ? 'RP Frame — leave queue' : 'RP Frame — join scene', icon: speaking ? 'fas fa-microphone' : 'fas fa-hand', onClick: () => command(speaking ? 'finish' : joined ? 'leave' : 'join') },
      { name: 'rp-frame-urgent', title: 'RP Frame — urgent speak', icon: 'fas fa-exclamation', onClick: () => command('urgent') },
      { name: 'rp-frame-delay', title: 'RP Frame — delay turn', icon: 'fas fa-forward', visible: speaking, onClick: () => command('delay') });
  }
  for (const tool of tools) {
    tool.button = true;
    tool.visible ??= true;
    if (Array.isArray(tokens.tools)) tokens.tools.push(tool);
    else {
      // Foundry 13+ invokes BOTH callbacks if present; register only its native API.
      const action = tool.onClick;
      delete tool.onClick;
      tool.onChange = (_event, active) => active ? action() : undefined;
      tokens.tools ??= {};
      tool.order = Object.keys(tokens.tools).length;
      tokens.tools[tool.name] = tool;
    }
  }
}

Hooks.once('init', () => { registerSettings(); registerKeybindings(); });
Hooks.once('socketlib.ready', registerSocket);
Hooks.once('ready', initialize);
Hooks.on('getSceneControlButtons', tokenControls);
for (const hook of ['renderPlayers', 'renderCameraViews', 'renderCameraPopout', 'canvasReady']) Hooks.on(hook, refresh);
Hooks.on('updateUser', refresh);
Hooks.on('canvasTearDown', () => { highlight?.reset(); voiceGlow?.reset(); });
Hooks.on('refreshToken', token => { highlight?.redraw(token); voiceGlow?.redraw(token); });
Hooks.on('createToken', () => refresh());
Hooks.on('userConnected', (user, isConnected) => {
  if (!isConnected) { if (roster.remove(user?.id)) renderVoice(); }
  else if (setting('voiceGlow')) voice?.announce();
  if (!controller?.ready) return;
  if (!isAuthority()) controller.authority = false;
  if (!isAuthority()) connection.poll(game.users.activeGM?.id, true);
  refresh();
});
Hooks.on('updateCombat', combat => {
  if (combat.started && setting('stopForCombat') && isAuthority()) void command('end');
});
// Push-to-talk mouse button: tracked on the window in capture so canvas or sheet handlers can't hide it.
// mousedown/mouseup too: a second button pressed while another is down fires no pointerdown/pointerup.
const pttButton = event => pttOn() && event.button === PTT_MOUSE[ptt.mouse];
const capture = { capture: true };
for (const type of ['pointerdown', 'mousedown']) globalThis.addEventListener?.(type, event => ptt.pointerDown(event.button), capture);
for (const type of ['pointerup', 'mouseup', 'auxclick']) {
  globalThis.addEventListener?.(type, event => {
    if (type !== 'auxclick') ptt.pointerUp(event.button);
    // Keep the browser's Back/Forward from firing on the talk button.
    if (pttButton(event)) event.preventDefault();
  }, capture);
}
// Foundry skips keybindings while a text field has focus, so a key released there would stay held.
const pttKeys = () => { try { return game.keybindings.get(MODULE_ID, 'voicePushToTalk').map(binding => binding.key); } catch { return []; } };
globalThis.addEventListener?.('keyup', event => { if (pttKeys().includes(event.code)) ptt.keyUp(); }, capture);
// Up events never arrive while Foundry is unfocused or hidden.
globalThis.addEventListener?.('blur', () => ptt.release());
globalThis.document?.addEventListener?.('visibilitychange', () => { if (document.visibilityState === 'hidden') ptt.release(); });
globalThis.addEventListener?.('pagehide', () => {
  globalThis.clearInterval(pollTimer);
  voice?.stop();
  if (isAuthority() && controller?.ready) socket?.executeForOthers('unavailable', session);
});
