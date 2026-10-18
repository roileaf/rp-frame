import { VoiceDetector, DEFAULT_THRESHOLD_DB, FLOOR_DB } from './voice-detector.mjs';
import { browserVoiceMic } from './voice-mic.mjs';
import { DEFAULT_APPEARANCE, APPEARANCE_RANGES, glowStyle, normalizeAppearance, normalizeAppearances } from './voice-glow.mjs';

const MODULE_ID = 'rp-frame';
const MIN_DB = -80, MAX_DB = -10;
const SLIDERS = [['size', 'Size'], ['brightness', 'Brightness'], ['opacity', 'Opacity']];
// Token and camera glow each have their own appearance controls, preview and reset.
const PARTS = [['token', 'Token glow'], ['camera', 'Camera glow']];
/** Per-part show toggles (client settings), so token and camera glow can be turned off independently. */
export const SHOW_SETTINGS = { token: 'voiceShowToken', camera: 'voiceShowCamera' };
// voicePttMouse values (see PTT_MOUSE in voice-ptt.mjs) and their labels.
const PTT_OPTIONS = [['none', 'None'], ['back', 'Mouse 4 (Back)'], ['forward', 'Mouse 5 (Forward)']];
const MIC_MESSAGES = {
  denied: 'Microphone access was blocked. Allow it in your browser to see the meter.',
  unavailable: 'No microphone available.',
  ended: 'Microphone disconnected.'
};
const get = key => game.settings.get(MODULE_ID, key);
const set = (key, value) => game.settings.set(MODULE_ID, key, value);
const percent = db => Math.min(100, Math.max(0, ((db - MIN_DB) / (MAX_DB - MIN_DB)) * 100));
const threshold = () => Number(get('voiceThreshold') ?? DEFAULT_THRESHOLD_DB);
const savedAppearances = () => normalizeAppearances(get('voiceAppearance'));

/** Players' status line for the world switch they can't change. */
export const tableStatus = on => on ? 'Voice glow is on for this table.' : 'Voice glow is off. Your GM can turn it on.';
/** Label of the button that starts or stops the window's own mic test. */
export const testLabel = testing => testing ? 'Stop test' : 'Test mic';
/** Test mic meter is green while testing, the detector says talking and the push-to-talk gate is open. */
export const meterTalking = (running, talking, open) => running && talking && open;

/**
 * The window's Test mic: each run gets a fresh mic, so overlapping getUserMedia calls that resolve
 * out of order can't orphan a stream. A run that was stopped before its mic opened releases it.
 */
export class MicTest {
  constructor(createMic) {
    this.createMic = createMic;
    this.mic = null;
  }

  get running() { return this.mic !== null; }

  /** Resolves 'ok', 'denied' or 'unavailable', or 'cancelled' if stopped (or restarted) meanwhile. */
  async start(onLevel, onEnded) {
    this.stop();
    const mic = this.mic = this.createMic();
    const current = () => this.mic === mic;
    let result;
    try { result = await mic.start(db => { if (current()) onLevel(db); }, () => { if (current()) onEnded(); }); }
    catch { result = 'unavailable'; }
    if (!current()) { mic.stop(); return 'cancelled'; }
    if (result !== 'ok') this.stop();
    return result;
  }

  stop() {
    const mic = this.mic;
    this.mic = null;
    mic?.stop();
  }
}

// Open windows, so a voice setting change (another GM, the consent dialog) can refresh them.
const open = new Set();
/** Refresh the Table status and the checkboxes of any open voice glow window. */
export function refreshVoiceSettings() {
  for (const app of open) {
    app.paintSettings();
    app.paint();
  }
}
/** Repaint the Test mic meter of any open voice glow window (push-to-talk pressed or released). */
export function refreshVoiceMeter() {
  for (const app of open) app.paint();
}

let apply = () => {};
let gate = () => true;
let AppClass;
/**
 * The single voice glow window: Table (world switch), My mic (opt-in, push-to-talk, test meter, threshold),
 * What I see (show, then token and camera glow appearance).
 * Every call sets `onAppearance`, which shows `{ token, camera }` appearances live without saving, and
 * `gate`, false while push-to-talk is on and not held (the Test mic meter then stays grey);
 * the cached class reads both at use time.
 */
export function voiceSettingsApp({ onAppearance, gate: pttGate } = {}) {
  if (onAppearance) apply = onAppearance;
  if (pttGate) gate = pttGate;
  if (AppClass) return AppClass;
  const Base = globalThis.foundry?.applications?.api?.ApplicationV2;
  if (!Base) return null;
  AppClass = class VoiceSettingsApp extends Base {
    static DEFAULT_OPTIONS = {
      classes: ['rp-frame-voice-app'],
      window: { title: 'Voice glow', icon: 'fa-solid fa-microphone-lines', resizable: true },
      position: { width: 640, height: 'auto' }
    };

    // This window's own mic test, separate from the voice service's mic; stopped on close.
    micTest = new MicTest(browserVoiceMic);
    detector = new VoiceDetector({ threshold: threshold() });
    level = FLOOR_DB;
    message = '';
    closed = false;
    appearances = savedAppearances();
    // Appearance live edits not yet saved; reverted on close.
    dirty = false;

    async _renderHTML() {
      const root = document.createElement('div');
      root.className = 'rp-frame-voice-editor';
      const value = this.detector.threshold;
      const table = game.user.isGM
        ? `<label class="rp-frame-voice-check"><input type="checkbox" data-setting="voiceGlow"> Voice glow for this world</label>`
        : `<p class="rp-frame-voice-hint" data-role="status"></p>`;
      const previews = {
        token: `<svg viewBox="0 0 160 160" width="160" height="160">
              <circle cx="80" cy="80" r="32" class="rp-frame-appearance-token"></circle>
              <g data-role="strokes"></g>
            </svg>`,
        camera: '<div class="rp-frame-appearance-camera"></div>'
      };
      const parts = PARTS.map(([part, title]) => {
        const appearance = this.appearances[part];
        const sliders = SLIDERS.map(([key, label]) => {
          const [min, max] = APPEARANCE_RANGES[key];
          return `<label class="rp-frame-voice-threshold">${label}
            <input type="range" name="${part}-${key}" data-key="${key}" min="${min}" max="${max}" step="0.05" value="${appearance[key]}">
            <output data-for="${part}-${key}"></output></label>`;
        }).join('');
        return `<div class="rp-frame-appearance-part" data-part="${part}">
          <h4><label class="rp-frame-voice-check"><input type="checkbox" data-setting="${SHOW_SETTINGS[part]}"> ${title}</label></h4>
          <div class="rp-frame-appearance-preview" aria-hidden="true">${previews[part]}</div>
          <label class="rp-frame-voice-threshold">Color
            <input type="color" name="${part}-color" data-key="color" value="${appearance.color}"></label>
          ${sliders}
          <div class="rp-frame-avatar-buttons">
            <button type="button" data-act="appearance-reset"><i class="fa-solid fa-rotate-left"></i> Reset to default</button>
          </div>
        </div>`;
      }).join('');
      root.innerHTML = `
        <section class="rp-frame-voice-section" data-section="table">
          <h3>Table</h3>
          ${table}
        </section>
        <section class="rp-frame-voice-section" data-section="mic">
          <h3>My mic</h3>
          <label class="rp-frame-voice-check"><input type="checkbox" data-setting="voiceUse"> Use my mic for voice glow</label>
          <label class="rp-frame-voice-check"><input type="checkbox" data-setting="voicePtt"> Push-to-talk: glow only while I hold my talk key</label>
          <label class="rp-frame-voice-threshold">Mouse button
            <select data-setting="voicePttMouse">${PTT_OPTIONS.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></label>
          <p class="rp-frame-voice-hint">Set a keyboard key in Configure Controls → RP Frame: push-to-talk.</p>
          <p class="rp-frame-voice-hint">Press Test mic and talk normally: the bar should turn green while you speak and stay grey when you're quiet. Only levels are measured; nothing is recorded or sent.</p>
          <div class="rp-frame-voice-meter" aria-hidden="true"><div class="rp-frame-voice-level"></div><div class="rp-frame-voice-marker"></div></div>
          <p class="rp-frame-voice-note" data-role="message" hidden></p>
          <label class="rp-frame-voice-threshold">Threshold
            <input type="range" data-role="threshold" min="${MIN_DB}" max="${MAX_DB}" step="1" value="${value}">
            <output data-role="threshold">${value} dB</output></label>
          <div class="rp-frame-avatar-buttons">
            <button type="button" data-act="test"><i class="fa-solid fa-microphone"></i> <span>${testLabel(false)}</span></button>
            <button type="button" data-act="threshold-reset"><i class="fa-solid fa-rotate-left"></i> Default</button>
          </div>
        </section>
        <section class="rp-frame-voice-section" data-section="look">
          <h3>What I see</h3>
          <label class="rp-frame-voice-check"><input type="checkbox" data-setting="voiceShow"> Show voice glow</label>
          <div class="rp-frame-appearance-parts">${parts}</div>
        </section>
        <footer class="rp-frame-avatar-buttons">
          <button type="button" data-act="close" class="rp-frame-primary"><i class="fa-solid fa-check"></i> Done</button>
        </footer>`;
      return root;
    }

    _replaceHTML(result, content) { content.replaceChildren(result); }

    _onFirstRender(context, options) {
      super._onFirstRender?.(context, options);
      open.add(this);
    }

    _onRender() {
      const root = this.element;
      const on = (selector, type, fn) => root.querySelector(selector)?.addEventListener(type, fn);
      // Table: only GMs get the checkbox (players' HTML has none).
      on('input[data-setting=voiceGlow]', 'change', event => void set('voiceGlow', event.target.checked));
      // My mic: the checkbox is the inverse of voiceOptOut.
      on('input[data-setting=voiceUse]', 'change', event => void set('voiceOptOut', !event.target.checked));
      on('input[data-setting=voicePtt]', 'change', event => void set('voicePtt', event.target.checked));
      on('select[data-setting=voicePttMouse]', 'change', event => void set('voicePttMouse', event.target.value));
      const slider = root.querySelector('input[data-role=threshold]');
      const saveThreshold = () => set('voiceThreshold', this.detector.threshold);
      slider.addEventListener('input', () => this.setThreshold(Number(slider.value)));
      slider.addEventListener('change', () => void saveThreshold());
      on('[data-act=threshold-reset]', 'click', () => { this.setThreshold(DEFAULT_THRESHOLD_DB); void saveThreshold(); });
      on('[data-act=test]', 'click', () => this.micTest.running ? this.stopTest() : void this.startTest());
      // What I see.
      on('input[data-setting=voiceShow]', 'change', event => void set('voiceShow', event.target.checked));
      for (const group of root.querySelectorAll('[data-part]')) {
        const part = group.dataset.part;
        group.querySelector('input[data-setting]').addEventListener('change', event => void set(SHOW_SETTINGS[part], event.target.checked));
        for (const input of group.querySelectorAll('input[data-key]')) {
          const read = () => ({ [input.dataset.key]: input.type === 'color' ? input.value : Number(input.value) });
          input.addEventListener('input', () => this.updateAppearance(part, read()));
          input.addEventListener('change', () => { this.updateAppearance(part, read()); void this.saveAppearance(); });
        }
        group.querySelector('[data-act=appearance-reset]').addEventListener('click', () => {
          this.updateAppearance(part, DEFAULT_APPEARANCE);
          void this.saveAppearance();
        });
      }
      on('[data-act=close]', 'click', () => this.close());
      this.paintSettings();
      this.paint();
      this.paintAppearance();
    }

    /** Test mic: an explicit, local action that works whether the world switch is on or off. */
    async startTest() {
      this.message = '';
      const pending = this.micTest.start(db => this.onLevel(db), () => { this.stopTest(); this.showMessage(MIC_MESSAGES.ended); });
      this.paint();
      const result = await pending;
      // 'cancelled': stopped, restarted or closed while getUserMedia was pending; MicTest already released that mic.
      if (result === 'cancelled' || this.closed) return;
      if (result !== 'ok') { this.stopTest(); this.showMessage(MIC_MESSAGES[result] ?? MIC_MESSAGES.unavailable); }
    }

    stopTest() {
      this.micTest.stop();
      this.level = FLOOR_DB;
      this.detector.reset();
      this.paint();
    }

    setThreshold(db) {
      this.detector.threshold = Math.min(MAX_DB, Math.max(MIN_DB, Math.round(db)));
      this.paint();
    }

    onLevel(db) {
      this.level = db;
      this.detector.sample(db, Date.now());
      this.paint();
    }

    showMessage(text) {
      this.message = text;
      this.paint();
    }

    /** Setting-bound controls: Table checkbox or status line, and the two personal checkboxes. */
    paintSettings() {
      const root = this.element;
      if (!root) return;
      root.querySelector('input[data-setting=voiceUse]').checked = !get('voiceOptOut');
      root.querySelector('input[data-setting=voiceShow]').checked = Boolean(get('voiceShow'));
      for (const key of Object.values(SHOW_SETTINGS)) root.querySelector(`input[data-setting=${key}]`).checked = Boolean(get(key));
      const ptt = Boolean(get('voicePtt'));
      root.querySelector('input[data-setting=voicePtt]').checked = ptt;
      const mouse = root.querySelector('select[data-setting=voicePttMouse]');
      mouse.value = get('voicePttMouse');
      mouse.disabled = !ptt;
      const enabled = Boolean(get('voiceGlow'));
      const box = root.querySelector('input[data-setting=voiceGlow]');
      if (box) box.checked = enabled;
      const status = root.querySelector('[data-role=status]');
      if (status) status.textContent = tableStatus(enabled);
    }

    /** My mic section: meter, threshold, test button and message (runs on every level reading). */
    paint() {
      const root = this.element;
      if (!root) return;
      const value = this.detector.threshold;
      const slider = root.querySelector('input[data-role=threshold]');
      if (Number(slider.value) !== value) slider.value = String(value);
      root.querySelector('output[data-role=threshold]').textContent = `${value} dB`;
      root.querySelector('.rp-frame-voice-level').style.width = `${percent(this.level)}%`;
      root.querySelector('.rp-frame-voice-marker').style.left = `${percent(value)}%`;
      root.querySelector('.rp-frame-voice-meter').classList.toggle('talking', meterTalking(this.micTest.running, this.detector.talking, gate()));
      root.querySelector('[data-act=test] span').textContent = testLabel(this.micTest.running);
      const message = root.querySelector('[data-role=message]');
      message.textContent = this.message;
      message.hidden = !this.message;
    }

    /** Change one part ('token' or 'camera'); the other part keeps its value. */
    updateAppearance(part, changes) {
      this.appearances = { ...this.appearances, [part]: normalizeAppearance({ ...this.appearances[part], ...changes }) };
      this.dirty = true;
      apply(this.appearances);
      this.paintAppearance();
    }

    async saveAppearance() {
      this.dirty = false;
      await set('voiceAppearance', { token: { ...this.appearances.token }, camera: { ...this.appearances.camera } });
    }

    paintAppearance() {
      const root = this.element;
      if (!root) return;
      const token = glowStyle(this.appearances.token);
      const color = this.appearances.token.color;
      // 64px token circle, as on the canvas: radius = 32 + pad.
      const radius = 32 + token.pad;
      root.querySelector('[data-role=strokes]').innerHTML = token.strokes.map(({ width, alpha }) =>
        `<circle cx="80" cy="80" r="${radius}" fill="none" stroke="${color}" stroke-width="${width}" stroke-opacity="${alpha}"></circle>`).join('');
      root.querySelector('.rp-frame-appearance-camera').style.boxShadow = glowStyle(this.appearances.camera).cameraShadow;
      for (const group of root.querySelectorAll('[data-part]')) {
        const appearance = this.appearances[group.dataset.part];
        for (const input of group.querySelectorAll('input[data-key]')) {
          const value = appearance[input.dataset.key];
          if (input.value !== String(value)) input.value = String(value);
          const output = group.querySelector(`output[data-for="${input.name}"]`);
          if (output) output.textContent = `${Math.round(value * 100)}%`;
        }
      }
    }

    _onClose(options) {
      super._onClose?.(options);
      open.delete(this);
      this.closed = true;
      this.micTest.stop();
      // Closed mid-drag without a release: drop the unsaved live preview.
      if (this.dirty) apply(savedAppearances());
    }
  };
  return AppClass;
}
