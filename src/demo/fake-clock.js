export class DeterministicClock {
  /** @param {string} [origin] */
  constructor(origin = '2026-08-22T02:00:00.000Z') {
    this.origin = Date.parse(origin);
    this.ticks = 0;
  }

  /** @param {number} [seconds] */
  now(seconds = 1) {
    this.ticks += seconds;
    return new Date(this.origin + this.ticks * 1000).toISOString();
  }
}

