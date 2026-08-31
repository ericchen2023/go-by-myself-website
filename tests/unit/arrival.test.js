import { describe, expect, it } from 'vitest';
import { describeRemaining, estimateRemainingSeconds, trackProgress } from '../../src/domain/arrival.js';
import { deliveryStatusCopy } from '../../src/domain/presentation.js';

const T0 = 1_700_000_000_000;

describe('estimating arrival from observed movement', () => {
  it('says nothing until the vehicle has moved a measurable amount', () => {
    expect(estimateRemainingSeconds([])).toBeNull();
    expect(estimateRemainingSeconds([{ progress: 0.1, at: T0 }])).toBeNull();
    // Two samples one second and one percent apart are noise, not a rate.
    expect(estimateRemainingSeconds([
      { progress: 0.10, at: T0 },
      { progress: 0.11, at: T0 + 1_000 }
    ])).toBeNull();
  });

  it('extrapolates the remaining fraction from the observed rate', () => {
    // A tenth of the segment every ten seconds, half way along.
    const samples = [0, 1, 2, 3, 4, 5].map((step) => ({ progress: step * 0.1, at: T0 + step * 10_000 }));
    expect(estimateRemainingSeconds(samples)).toBe(50);
  });

  it('reports arrival rather than a duration once the segment is finished', () => {
    expect(estimateRemainingSeconds([
      { progress: 0.5, at: T0 },
      { progress: 1, at: T0 + 30_000 }
    ])).toBe(0);
  });

  it('refuses an estimate that would be too coarse to act on', () => {
    // A hundredth of a percent per minute: hours away, and not worth stating.
    const samples = [
      { progress: 0.0001, at: T0 },
      { progress: 0.0003, at: T0 + 600_000 }
    ];
    expect(estimateRemainingSeconds(samples)).toBeNull();
  });

  it('drops samples from the previous segment', () => {
    const onFirst = trackProgress([], { segmentId: 'edge-a', progress: 0.8 }, null, T0);
    const onSecond = trackProgress(onFirst, { segmentId: 'edge-b', progress: 0.05 }, 'edge-a', T0 + 5_000);
    // Carrying 0.8 across would read as the vehicle running backwards.
    expect(onSecond).toEqual([{ progress: 0.05, at: T0 + 5_000 }]);
  });

  it('keeps samples while the segment holds', () => {
    const first = trackProgress([], { segmentId: 'edge-a', progress: 0.1 }, null, T0);
    const second = trackProgress(first, { segmentId: 'edge-a', progress: 0.2 }, 'edge-a', T0 + 5_000);
    expect(second).toHaveLength(2);
  });

  it('forgets everything when the position disappears', () => {
    expect(trackProgress([{ progress: 0.4, at: T0 }], null, 'edge-a', T0 + 1_000)).toEqual([]);
  });
});

describe('what the sender is told while a vehicle is on its way', () => {
  it('separates preparing to depart from actually driving', () => {
    const preparing = deliveryStatusCopy('dispatching', { connectivity: 'online', positionQuality: 'valid' });
    expect(preparing.title).toBe('車輛準備出發');
    expect(preparing.detail).toContain('載入該路段地圖');

    const driving = deliveryStatusCopy('dispatching', {
      connectivity: 'online', positionQuality: 'valid',
      position: { segmentId: 'edge-a', progress: 0.42 }
    });
    expect(driving.title).toBe('車輛行駛中');
    expect(driving.detail).toContain('42%');
  });

  it('states an arrival estimate only when one was given', () => {
    const overlay = { connectivity: 'online', positionQuality: 'valid', position: { segmentId: 'edge-a', progress: 0.5 } };
    expect(deliveryStatusCopy('dispatching', overlay).detail).toContain('需要再觀察');
    expect(deliveryStatusCopy('dispatching', { ...overlay, etaSeconds: 120 }).detail).toContain('2 分鐘');
  });

  it('keeps the safety overlays ahead of the progress copy', () => {
    const offRoute = deliveryStatusCopy('dispatching', {
      positionQuality: 'invalid', position: { segmentId: 'edge-a', progress: 0.5 }
    });
    expect(offRoute.title).toBe('車輛位置需要確認');
  });

  it('reads a near arrival as arriving rather than as zero minutes', () => {
    expect(describeRemaining(12)).toBe('即將抵達');
    expect(describeRemaining(45)).toBe('預計約 1 分鐘後抵達');
  });
});
