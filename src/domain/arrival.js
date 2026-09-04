/**
 * Estimating arrival from what the projection actually carries.
 *
 * The browser is given a segment and a fraction along it, nothing else — no
 * speed, no distance in metres, no server-side estimate. So the only honest
 * estimate is the one the reader could make themselves: watch how fast the
 * fraction is climbing and extrapolate.
 *
 * That means it is worthless until the vehicle has moved a measurable amount,
 * and it must say nothing rather than guess. A number invented before there is
 * evidence for it is worse than no number: it will be wrong at exactly the
 * moment someone decides whether to walk to the stop.
 */

/** Samples closer together than this add noise rather than signal. */
const MIN_SPAN_SECONDS = 4;
/** Below this the vehicle has not moved enough to extrapolate from. */
const MIN_PROGRESS_DELTA = 0.02;
/** Beyond this the estimate is too coarse to be worth showing as a number. */
const MAX_REPORTABLE_SECONDS = 90 * 60;

/**
 * @param {ReadonlyArray<{progress: number, at: number}>} samples oldest first
 * @returns {number|null} seconds remaining, or null when there is no basis
 */
export function estimateRemainingSeconds(samples) {
  if (!Array.isArray(samples) || samples.length < 2) return null;
  const last = samples[samples.length - 1];
  if (!Number.isFinite(last.progress) || last.progress >= 1) return 0;

  const first = samples.find((sample) =>
    last.at - sample.at >= MIN_SPAN_SECONDS * 1000 && last.progress - sample.progress >= MIN_PROGRESS_DELTA);
  if (!first) return null;

  const seconds = (last.at - first.at) / 1000;
  const rate = (last.progress - first.progress) / seconds;
  if (!(rate > 0)) return null;

  const remaining = (1 - last.progress) / rate;
  if (!Number.isFinite(remaining) || remaining < 0 || remaining > MAX_REPORTABLE_SECONDS) return null;
  return Math.round(remaining);
}

/**
 * Keeps the samples one journey's estimate is built from.
 *
 * Progress here is the fraction of the whole journey, so samples stay valid
 * across the stops it passes through. They are dropped only when the journey
 * itself changes — a different route means the old readings describe a
 * different trip, and carrying them over would read as a jump.
 *
 * @param {ReadonlyArray<{progress: number, at: number}>} samples
 * @param {number|null|undefined} progress fraction of the whole journey, 0..1
 * @param {string|null|undefined} journeyKey identifies which journey this is
 * @param {string|null|undefined} previousJourneyKey the key from the last call
 * @param {number} at
 * @returns {{progress: number, at: number}[]}
 */
export function trackProgress(samples, progress, journeyKey, previousJourneyKey, at) {
  if (!Number.isFinite(progress) || !journeyKey) return [];
  // 換的是**整趟**才重來，不是換一條邊就重來。一趟 LIBRARY→ADMIN 橫跨三條邊，
  // 以邊為單位的話每經過一站樣本就被清空，估算隨即消失、再從接近零的進度重新
  // 累積 —— 於是最需要它的後半段反而最不準。
  const carried = journeyKey === previousJourneyKey ? [...samples] : [];
  const latest = carried[carried.length - 1];
  if (latest && latest.progress === progress) return carried;
  return [...carried, { progress, at }].slice(-40);
}

/** @param {number} seconds */
export function describeRemaining(seconds) {
  if (seconds <= 30) return '即將抵達';
  const minutes = Math.round(seconds / 60);
  return minutes <= 1 ? '預計約 1 分鐘後抵達' : `預計約 ${minutes} 分鐘後抵達`;
}
