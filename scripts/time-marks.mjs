/**
 * Scene time marks: which "N minutes" mark, if any, to post now. No Foundry dependencies.
 * The first look at a scene (or a new interval) only records the current mark, so a GM who
 * refreshes or takes over mid-scene doesn't repeat marks that were already posted.
 */
export class TimeMarks {
  constructor() {
    this.key = null;
    this.mark = 0;
  }

  /** Returns the mark number to post (1 = first interval), or null. */
  check(startedAt, now, everyMs) {
    if (!Number.isFinite(startedAt) || !(everyMs > 0)) { this.key = null; return null; }
    const key = `${startedAt}|${everyMs}`;
    const mark = Math.max(0, Math.floor((now - startedAt) / everyMs));
    if (key !== this.key) { this.key = key; this.mark = mark; return null; }
    if (mark <= this.mark) return null;
    this.mark = mark;
    return mark;
  }
}

/** 10 minutes, 1 hour, 1 hour 20 minutes. */
export function formatMinutes(total) {
  const hours = Math.floor(total / 60), minutes = total % 60;
  const part = (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'}`;
  return [hours && part(hours, 'hour'), (minutes || !hours) && part(minutes, 'minute')].filter(Boolean).join(' ');
}
