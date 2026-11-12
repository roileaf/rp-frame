import { MAX_ANSWER, MAX_OPTIONS, MAX_QUESTION, pollResults } from './poll-state.mjs';

export const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const nameOf = (users, id) => users.get(id)?.name ?? 'Someone';

/** One-click answer sets for the Ask form; `choices: null` means free-text answers. */
export const PRESETS = [
  { id: 'yes-no', label: 'Yes / No', choices: ['Yes', 'No'] },
  { id: 'yes-no-maybe', label: 'Yes / No / Maybe', choices: ['Yes', 'No', 'Maybe'] },
  { id: 'ready', label: 'Ready / Not yet', choices: ['Ready', 'Not yet'] },
  { id: 'scale', label: '1–5', choices: ['1', '2', '3', '4', '5'] },
  { id: 'text', label: 'Free answer', choices: null }
];

export const emptyDraft = () => ({ question: '', choices: ['', ''], freeText: false, anonymous: false });

/** The ask command's options: filled-in choices, or none for a free-text poll. */
export const draftOptions = draft => draft.freeText ? [] : draft.choices.map(choice => choice.trim()).filter(Boolean);

/** The preset the draft currently matches, or null for custom choices. */
export function activePreset(draft) {
  if (draft.freeText) return 'text';
  const choices = draft.choices.map(choice => choice.trim());
  return PRESETS.find(preset => preset.choices && preset.choices.length === choices.length && preset.choices.every((choice, i) => choice === choices[i]))?.id ?? null;
}

/** What one viewer sees: results show once they answered, the poll closed, or they own it. GMs never answer. */
export function pollView(poll, { userId, isGM, users, voters }) {
  if (!poll?.question) return null;
  const owner = isGM || poll.askerId === userId;
  const mine = Object.hasOwn(poll.answers, userId) ? poll.answers[userId] : null;
  const answered = Object.keys(poll.answers).length;
  return {
    id: poll.id, question: poll.question, asker: nameOf(users, poll.askerId), open: poll.open, owner, canAnswer: poll.open && !isGM,
    freeText: !poll.options.length, mine, anonymous: poll.anonymous,
    answered, expected: voters, progress: voters ? Math.min(1, answered / voters) : 0,
    showResults: !poll.open || owner || mine !== null,
    results: pollResults(poll)
  };
}

/** Open polls first, newest first within each group. */
export const pollOrder = polls => [...polls].sort((a, b) => Number(b.open) - Number(a.open) || b.id - a.id);

/** A key naming a text field (which poll, which field, which choice) so focus survives a re-render. */
const fieldKey = node => node?.name ? `${node.closest('[data-poll]')?.dataset.poll ?? ''}|${node.name}|${node.dataset.index ?? ''}` : null;

let AppClass, host;
/**
 * The poll window: a card per poll (choices double as result bars) and the Ask form,
 * shown when there are no polls or New poll was pressed.
 * `host` supplies { polls(), userId(), isGM(), users(), voters(), command(type, data) }; the class reads it at use time.
 */
export function pollApp(pollHost) {
  if (pollHost) host = pollHost;
  if (AppClass) return AppClass;
  const Base = globalThis.foundry?.applications?.api?.ApplicationV2;
  if (!Base) return null;
  AppClass = class PollApp extends Base {
    static DEFAULT_OPTIONS = {
      id: 'rp-frame-poll',
      classes: ['rp-frame-voice-app', 'rp-frame-poll-app'],
      window: { title: 'Table polls', icon: 'fa-solid fa-square-poll-vertical', resizable: true },
      position: { width: 440, height: 'auto' }
    };

    asking = false;
    // Typed text survives re-renders caused by other players' answers; free-text drafts are kept per poll ID.
    draft = emptyDraft();
    answers = new Map();
    focus = null;

    async _renderHTML() {
      const root = document.createElement('div');
      root.className = 'rp-frame-poll';
      const context = { userId: host.userId(), isGM: host.isGM(), users: host.users(), voters: host.voters() };
      const views = pollOrder(host.polls()).map(poll => pollView(poll, context)).filter(Boolean);
      const open = views.filter(view => view.open).length;
      const toolbar = `<div class="rp-frame-poll-toolbar">
          <span>${open ? `${open} open` : 'No open polls'}${views.length > open ? ` · ${views.length - open} closed` : ''}</span>
          <button type="button" class="rp-frame-poll-new" data-act="new"><i class="fa-solid fa-plus"></i> New poll</button>
        </div>`;
      const top = this.asking || !views.length ? this.askHTML(views.length > 0) : toolbar;
      root.innerHTML = top + views.map(view => this.pollHTML(view, context)).join('');
      return root;
    }

    askHTML(cancel) {
      const draft = this.draft, preset = activePreset(draft);
      const presets = PRESETS.map(({ id, label }) =>
        `<button type="button" class="rp-frame-poll-preset${preset === id ? ' active' : ''}" data-act="preset" data-preset="${id}">${escapeHtml(label)}</button>`).join('');
      const choices = draft.freeText
        ? '<p class="rp-frame-poll-note">Everyone types their own answer.</p>'
        : `${draft.choices.map((choice, index) => `<div class="rp-frame-poll-choice">
              <input type="text" name="choice" data-index="${index}" maxlength="${MAX_ANSWER}" value="${escapeHtml(choice)}" placeholder="Choice ${index + 1}">
              ${draft.choices.length > 2 ? `<button type="button" data-act="remove-choice" data-index="${index}" aria-label="Remove choice"><i class="fa-solid fa-xmark"></i></button>` : ''}
            </div>`).join('')}
          ${draft.choices.length < MAX_OPTIONS ? '<button type="button" class="rp-frame-poll-add" data-act="add-choice"><i class="fa-solid fa-plus"></i> Add choice</button>' : ''}`;
      return `<section class="rp-frame-poll-card rp-frame-poll-ask">
          <div class="rp-frame-poll-head"><h3>Ask the table</h3></div>
          <label>Question
            <input type="text" name="question" maxlength="${MAX_QUESTION}" value="${escapeHtml(draft.question)}" placeholder="Where should we camp tonight?"></label>
          <div class="rp-frame-poll-field">Answers <div class="rp-frame-poll-presets">${presets}</div></div>
          ${choices}
          <label class="rp-frame-voice-check"><input type="checkbox" name="anonymous" ${draft.anonymous ? 'checked' : ''}> Hide names in results</label>
          <div class="rp-frame-poll-submit">
            ${cancel ? '<button type="button" data-act="cancel">Cancel</button>' : ''}
            <button type="button" data-act="ask" class="rp-frame-primary"><i class="fa-solid fa-paper-plane"></i> Ask everyone</button>
          </div>
        </section>`;
    }

    pollHTML(view, { userId, users }) {
      const status = view.open
        ? `${escapeHtml(view.asker)} asked · ${view.answered} of ${view.expected} answered`
        : `${escapeHtml(view.asker)} asked · ${view.answered} answered`;
      const meta = `<div class="rp-frame-poll-meta"><span>${status}${view.anonymous ? ' · names hidden' : ''}</span>
          ${view.open ? `<div class="rp-frame-poll-progress"><div style="width:${Math.round(view.progress * 100)}%"></div></div>` : ''}</div>`;
      let body;
      if (view.freeText) {
        const value = this.answers.get(view.id) ?? (typeof view.mine === 'string' ? view.mine : '');
        const answer = view.canAnswer ? `<div class="rp-frame-poll-answer">
            <input type="text" name="answer" maxlength="${MAX_ANSWER}" value="${escapeHtml(value)}" placeholder="Your answer">
            <button type="button" data-act="send" class="rp-frame-poll-send rp-frame-primary">${view.mine === null ? 'Send' : 'Update'}</button>
          </div>` : '';
        const texts = !view.showResults ? '<p class="rp-frame-poll-note">Answers appear after you send yours.</p>'
          : view.results.texts.length ? `<ul class="rp-frame-poll-texts">${view.results.texts.map(({ userId: author, text }) =>
            `<li class="${author && author === userId ? 'mine' : ''}">${author ? `<span class="rp-frame-poll-who">${escapeHtml(nameOf(users, author))}</span>` : ''}${escapeHtml(text)}</li>`).join('')}</ul>`
          : '<p class="rp-frame-poll-note">No answers yet.</p>';
        body = answer + texts;
      } else {
        const rows = view.results.options.map((option, index) => {
          const share = view.results.total ? Math.round((option.count / view.results.total) * 100) : 0;
          const mine = view.mine === index;
          const who = view.showResults && option.voters.length ? `<span class="rp-frame-poll-who">${option.voters.map(id => escapeHtml(nameOf(users, id))).join(', ')}</span>` : '';
          return `<button type="button" class="rp-frame-poll-option${mine ? ' mine' : ''}" data-act="vote" data-index="${index}" ${view.canAnswer ? '' : 'disabled'}>
              ${view.showResults ? `<span class="rp-frame-poll-fill" style="width:${share}%"></span>` : ''}
              <span class="rp-frame-poll-label"><span>${mine ? '<i class="fa-solid fa-circle-check"></i>' : ''}${escapeHtml(option.label)}</span>${who}</span>
              ${view.showResults ? `<span class="rp-frame-poll-count">${option.count} · ${share}%</span>` : ''}
            </button>`;
        }).join('');
        body = `<div class="rp-frame-poll-options">${rows}</div>${view.showResults ? '' : '<p class="rp-frame-poll-note">Results appear after you vote.</p>'}`;
      }
      const actions = [];
      if (view.owner && view.open) actions.push('<button type="button" data-act="close-poll"><i class="fa-solid fa-lock"></i> Close</button>');
      if (view.owner) actions.push('<button type="button" data-act="clear"><i class="fa-solid fa-trash"></i> Remove</button>');
      return `<section class="rp-frame-poll-card${view.open ? '' : ' closed'}" data-poll="${view.id}">
          <div class="rp-frame-poll-head"><h3>${escapeHtml(view.question)}</h3><span class="rp-frame-poll-pill">${view.open ? 'Open' : 'Closed'}</span></div>
          ${meta}
          ${body}
          ${actions.length ? `<div class="rp-frame-poll-actions">${actions.join('')}</div>` : ''}
        </section>`;
    }

    _replaceHTML(result, content) {
      // Other players' answers re-render the window; keep the field being typed in focused.
      const active = content.contains(document.activeElement) ? document.activeElement : null;
      if (active && !this.focus) this.focus = { key: fieldKey(active), start: active.selectionStart, end: active.selectionEnd };
      content.replaceChildren(result);
    }

    _onRender() {
      const root = this.element;
      const on = (selector, type, fn) => { for (const node of root.querySelectorAll(selector)) node.addEventListener(type, fn); };
      const pollId = event => Number(event.currentTarget.closest('[data-poll]').dataset.poll);
      const index = event => Number(event.currentTarget.dataset.index);
      const rerender = focus => { this.focus = focus ?? null; void this.render(); };
      on('input[name=question]', 'input', event => { this.draft.question = event.target.value; });
      on('input[name=choice]', 'input', event => {
        this.draft.choices[index(event)] = event.target.value;
        this.paintPresets();
      });
      on('input[name=anonymous]', 'change', event => { this.draft.anonymous = event.target.checked; });
      on('[data-act=preset]', 'click', event => {
        const preset = PRESETS.find(preset => preset.id === event.currentTarget.dataset.preset);
        this.draft.freeText = !preset.choices;
        if (preset.choices) this.draft.choices = [...preset.choices];
        rerender();
      });
      on('[data-act=add-choice]', 'click', () => {
        this.draft.choices.push('');
        rerender({ key: `|choice|${this.draft.choices.length - 1}` });
      });
      on('[data-act=remove-choice]', 'click', event => { this.draft.choices.splice(index(event), 1); rerender(); });
      on('input[name=answer]', 'input', event => this.answers.set(pollId(event), event.target.value));
      on('input[name=answer], input[name=question], input[name=choice]', 'keydown', event => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        if (event.target.name === 'answer') this.send(pollId(event));
        else void this.ask();
      });
      on('[data-act=ask]', 'click', () => void this.ask());
      on('[data-act=cancel]', 'click', () => { this.asking = false; rerender(); });
      on('[data-act=new]', 'click', () => { this.asking = true; rerender({ key: '|question|' }); });
      on('[data-act=vote]', 'click', event => void host.command('answer', { pollId: pollId(event), value: index(event) }));
      on('[data-act=send]', 'click', event => this.send(pollId(event)));
      on('[data-act=close-poll]', 'click', event => void host.command('close', { pollId: pollId(event) }));
      on('[data-act=clear]', 'click', event => void host.command('clear', { pollId: pollId(event) }));
      this.restoreFocus();
    }

    restoreFocus() {
      const focus = this.focus;
      this.focus = null;
      if (!focus?.key) return;
      const field = [...this.element.querySelectorAll('input[name]')].find(node => fieldKey(node) === focus.key);
      if (!field) return;
      field.focus();
      if (Number.isInteger(focus.start)) field.setSelectionRange(focus.start, focus.end);
    }

    /** Highlight the matching preset while choices are typed, without re-rendering the form. */
    paintPresets() {
      const preset = activePreset(this.draft);
      for (const chip of this.element.querySelectorAll('[data-act=preset]')) chip.classList.toggle('active', chip.dataset.preset === preset);
    }

    send(id) {
      const value = (this.answers.get(id) ?? '').trim();
      if (!value) return;
      this.answers.delete(id);
      void host.command('answer', { pollId: id, value });
    }

    async ask() {
      const question = this.draft.question.trim();
      if (!question) { ui.notifications?.warn('Type a question first.'); return; }
      const options = draftOptions(this.draft);
      if (!this.draft.freeText && options.length < 2) { ui.notifications?.warn('Fill in at least two choices, or pick Free answer.'); return; }
      if (await host.command('ask', { question, options, anonymous: this.draft.anonymous }) === false) return;
      this.asking = false;
      this.draft = emptyDraft();
    }

    /** Repaint on any poll change, dropping drafts for polls that are gone. */
    pollsChanged(polls) {
      const ids = new Set(polls.map(poll => poll.id));
      for (const id of this.answers.keys()) if (!ids.has(id)) this.answers.delete(id);
      if (this.rendered) void this.render();
    }
  };
  return AppClass;
}
