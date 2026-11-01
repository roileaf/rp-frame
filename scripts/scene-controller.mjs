import { emptyScene, readScene, transition } from './scene-state.mjs';

const SCENE_RULES = { empty: emptyScene, read: readScene, transition };

/**
 * Serializes GM writes and persists before publishing. Injected host makes socket races testable.
 * `rules` ({ empty, read, transition }) default to RP scenes; polls reuse the same pipeline.
 */
export class SceneController {
  constructor(host, rules = SCENE_RULES) {
    this.host = host;
    this.rules = rules;
    this.state = rules.empty();
    this.ready = false;
    this.authority = false;
    this.tail = Promise.resolve();
  }

  async initialize() {
    if (this.initializing) return this.initializing;
    this.ready = false;
    this.initializing = (async () => {
      await this.tail;
      this.state = this.rules.read(await this.host.load(), this.host.isPlayer);
      this.ready = true;
      this.authority = this.host.isAuthority();
      this.host.changed(this.state);
      if (this.authority) this.host.publish(this.state);
    })();
    try { await this.initializing; }
    finally { this.initializing = null; }
  }

  enqueue(command, actor) {
    const job = this.tail.then(async () => {
      if (!this.ready || !this.host.isAuthority()) return false;
      // A newly elected GM always reads persisted state before accepting commands.
      if (!this.authority) {
        this.state = this.rules.read(await this.host.load(), this.host.isPlayer);
        this.authority = true;
      }
      const now = this.host.now();
      const next = this.rules.transition(this.state, command, actor, { isPlayer: this.host.isPlayer, combat: this.host.inCombat(), now });
      if (next === this.state) return false;
      next.revision = Math.max(now, this.state.revision + 1);
      await this.host.save(next);
      if (!this.host.isAuthority()) { this.authority = false; return false; }
      this.state = next;
      this.host.changed(next);
      this.host.publish(next);
      return true;
    });
    this.tail = job.catch(error => this.host.error(error));
    return job;
  }

  accept(snapshot) {
    const next = this.rules.read(snapshot, this.host.isPlayer);
    if (next.revision < this.state.revision) return false;
    if (JSON.stringify(next) === JSON.stringify(this.state)) return true;
    this.state = next;
    this.host.changed(next);
    return true;
  }
}
