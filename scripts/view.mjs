import { waitingOrder } from './scene-state.mjs';

/** Turn timer text: 0:42, 3:05, 1:02:09. */
export function formatDuration(ms) {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  const pad = n => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function displayName(user) {
  return (user?.character?.name || user?.name || 'Player').split(/\s+/)[0];
}

/** Speaker banner presentation. */
export function scenePresentation(state, { users, userId, isGM, connected }) {
  const speaker = users.get(state.speaker);
  let text;
  if (state.active) text = !isGM && !connected ? 'Waiting for GM'
    : speaker ? (speaker.id === userId ? 'You are speaking' : `${displayName(speaker)} speaks`) : 'RP scene started';
  else if (state.participants.length) text = state.participants.includes(userId)
    ? 'You want to start RP scene' : 'Someone wants to start RP scene';
  else return null;
  return {
    text, speakerId: speaker?.id ?? null,
    portrait: speaker?.avatar || speaker?.character?.img || '',
    tone: state.active && speaker ? 'speaker' : 'request',
    waiting: state.active && !isGM && !connected,
    // When the speaker's turn began; null with no speaker.
    since: state.active && speaker ? state.since : null,
    queue: waitingOrder(state).map((id, index) => ({ id, name: displayName(users.get(id)), position: index + 1, urgent: state.urgent.includes(id) }))
  };
}

export class SceneView {
  constructor(host) { this.host = host; this.root = null; this.drag = null; }

  context() { return this.host.context(); }

  render(state) {
    if (!document.body) return;
    this.state = state;
    const context = this.context();
    const presentation = scenePresentation(state, context);
    if (!presentation || !this.host.showBanner()) {
      this.root?.remove(); this.root = null;
      this.since = null;
      this.tick();
    } else {
      if (!this.root) this.createBanner();
      // Update text in place: disconnect/reconnect never replaces the banner.
      this.root.dataset.tone = presentation.tone;
      this.root.dataset.waiting = String(presentation.waiting);
      this.text.textContent = presentation.text;
      this.since = this.host.showTimer?.() ? presentation.since : null;
      this.tick();
      this.avatar.hidden = !presentation.portrait;
      this.avatar.src = presentation.portrait;
      this.avatar.alt = '';
      this.queue.replaceChildren();
      for (const item of presentation.queue) {
        const chip = element('button', `rp-frame-chip${item.urgent ? ' urgent' : ''}`);
        chip.type = 'button';
        chip.title = context.isGM ? `Choose ${item.name}; right-click to remove` : `${item.name}, position ${item.position}`;
        chip.append(element('span', 'rp-frame-position', String(item.position)), element('span', '', item.name));
        chip.disabled = !context.isGM;
        chip.addEventListener('click', event => { event.stopPropagation(); void this.host.command('choose', item.id); });
        chip.addEventListener('contextmenu', event => {
          if (!context.isGM) return;
          event.preventDefault(); void this.host.command('remove', item.id);
        });
        this.queue.append(chip);
      }
    }
    this.badges(state);
  }

  createBanner() {
    this.root = element('section', 'rp-frame-banner');
    this.root.id = 'rp-frame-banner';
    this.root.setAttribute('aria-label', 'RP Frame');
    this.avatar = element('img', 'rp-frame-avatar');
    this.text = element('div', 'rp-frame-text');
    this.timer = element('span', 'rp-frame-timer');
    this.timer.title = 'How long the current speaker has had the spotlight';
    this.text.setAttribute('role', 'status');
    this.text.setAttribute('aria-live', 'polite');
    this.queue = element('div', 'rp-frame-queue');
    this.queue.setAttribute('aria-label', 'Talking queue');
    const resize = element('button', 'rp-frame-resize');
    resize.title = 'Resize RP Frame';
    resize.setAttribute('aria-label', resize.title);
    // Name and turn timer share a row so the timer never wraps under the name.
    const heading = element('div', 'rp-frame-heading');
    heading.append(this.text, this.timer);
    this.root.append(this.avatar, heading, this.queue, resize);
    document.body.append(this.root);
    const layout = this.host.layout() ?? {};
    this.applySize(layout.width, layout.height);
    if (Number.isFinite(layout.x) && Number.isFinite(layout.y)) this.applyPosition(layout.x, layout.y);
    this.root.addEventListener('pointerdown', event => {
      if (event.button !== 0 || event.target.closest('button') && event.target !== resize) return;
      const rect = this.root.getBoundingClientRect();
      this.drag = { id: event.pointerId, resize: event.target === resize, x: event.clientX, y: event.clientY, rect };
      this.root.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    this.root.addEventListener('pointermove', event => {
      if (this.drag?.id !== event.pointerId) return;
      const { x, y, rect, resize: resizing } = this.drag;
      const dx = event.clientX - x, dy = event.clientY - y;
      if (resizing) {
        this.applySize(rect.width + dx, rect.height + dy);
      } else {
        this.applyPosition(rect.left + dx, rect.top + dy);
      }
    });
    const finish = event => {
      if (this.drag?.id !== event.pointerId) return;
      const rect = this.root.getBoundingClientRect();
      this.drag = null;
      void this.host.saveLayout({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
    };
    this.root.addEventListener('pointerup', finish);
    this.root.addEventListener('pointercancel', finish);
  }

  /** Paint the turn timer; ticks every second only while a turn is being timed. */
  tick() {
    const timing = Number.isFinite(this.since) && Boolean(this.root);
    if (this.timer) {
      this.timer.hidden = !timing;
      this.timer.textContent = timing ? formatDuration(Date.now() - this.since) : '';
    }
    if (timing && !this.ticker) this.ticker = setInterval(() => this.tick(), 1000);
    else if (!timing && this.ticker) { clearInterval(this.ticker); this.ticker = null; }
  }

  applyPosition(x, y) {
    const rect = this.root.getBoundingClientRect();
    this.root.classList.add('is-positioned');
    this.root.style.left = `${Math.round(Math.max(0, Math.min(innerWidth - rect.width, x)))}px`;
    this.root.style.top = `${Math.round(Math.max(0, Math.min(innerHeight - rect.height, y)))}px`;
  }

  applySize(width, height) {
    if (!Number.isFinite(width) || !Number.isFinite(height)) return;
    width = Math.round(Math.max(180, Math.min(innerWidth * .94, width)));
    height = Math.round(Math.max(68, Math.min(innerHeight * .8, height)));
    this.root.classList.add('is-sized');
    this.root.style.width = `${width}px`;
    this.root.style.minHeight = `${height}px`;
    this.root.style.setProperty('--rp-frame-scale', String(Math.round(Math.min(4, Math.max(1, Math.min(width / 260, height / 68))) * 100) / 100));
  }

  badges(state) {
    document.querySelectorAll('.rp-frame-badge').forEach(node => node.remove());
    document.querySelectorAll('.camera-view.rp-frame-speaking').forEach(node => node.classList.remove('rp-frame-speaking'));
    if (!this.host.showBadges()) return;
    for (const container of document.querySelectorAll('.camera-view, #players [data-user-id], #players-active [data-user-id], #players-inactive [data-user-id]')) {
      const id = container.dataset.user || container.dataset.userId;
      if (!state.participants.includes(id)) continue;
      const speaking = state.active && state.speaker === id;
      const urgent = state.urgent.includes(id);
      const badge = element('span', `rp-frame-badge${speaking ? ' speaking' : urgent ? ' urgent' : ''}`, speaking ? '●' : urgent ? '!' : String(waitingOrder(state).indexOf(id) + 1));
      badge.title = speaking ? 'Speaking' : urgent ? 'Urgent speak' : 'RP queue';
      badge.setAttribute('aria-label', badge.title);
      // Cameras: pin the badge to the video's corner (CSS .camera-view > .rp-frame-badge) instead of
      // inside the name label, where it overlapped the player's name. Player list: after the name.
      const isCamera = container.classList.contains('camera-view');
      (isCamera ? container : container.querySelector('.player-name') ?? container).append(badge);
      if (speaking && isCamera) container.classList.add('rp-frame-speaking');
    }
  }
}
