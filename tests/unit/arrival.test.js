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

  it('keeps samples across the stops a journey passes through', () => {
    // 一趟 LIBRARY→ADMIN 橫跨三條邊。以邊為單位重置的話，每經過一站樣本就被
    // 清空、估算隨即消失 —— 後半段反而最不準。整趟是同一段旅程，樣本要留著。
    const journey = 'edge-library-hss2>edge-hss2-hss1>edge-hss1-admin';
    const first = trackProgress([], 0.30, journey, null, T0);
    const afterAStop = trackProgress(first, 0.42, journey, journey, T0 + 5_000);
    expect(afterAStop).toHaveLength(2);
  });

  it('drops samples when the journey itself changes', () => {
    const outbound = trackProgress([], 0.8, 'edge-a', null, T0);
    const returning = trackProgress(outbound, 0.05, 'edge-b', 'edge-a', T0 + 5_000);
    // 換了一趟，舊讀數描述的是另一段行程；沿用會讀成車在倒退。
    expect(returning).toEqual([{ progress: 0.05, at: T0 + 5_000 }]);
  });

  it('forgets everything when the position disappears', () => {
    expect(trackProgress([{ progress: 0.4, at: T0 }], null, 'edge-a', 'edge-a', T0 + 1_000)).toEqual([]);
  });
});

describe('what the sender is told while a vehicle is on its way', () => {
  it('separates preparing to depart from actually driving', () => {
    const preparing = deliveryStatusCopy('dispatching', { connectivity: 'online', positionQuality: 'valid' });
    expect(preparing.title).toBe('車輛準備出發');
    expect(preparing.detail).toContain('載入該路段地圖');

    const driving = deliveryStatusCopy('dispatching', {
      connectivity: 'online', positionQuality: 'valid',
      position: { segmentId: 'edge-a', progress: 0.9 },
      journeyProgress: 0.42
    });
    expect(driving.title).toBe('車輛行駛中');
    // 進度是整趟的比例，不是當前那一條邊的 —— 車在邊上走了 90%，整趟才 42%。
    expect(driving.metrics.progressPercent).toBe(42);
  });

  it('reports progress along the whole journey, not the current edge', () => {
    // 使用者回報的症狀：車過了人社一館之後，畫面的百分比就以「人社一→行政」
    // 為準重新開始 —— 於是同一趟旅程的進度會倒退。
    const nearEndOfFirstEdge = deliveryStatusCopy('in_transit', {
      connectivity: 'online', positionQuality: 'valid',
      position: { segmentId: 'edge-library-hss2', progress: 0.99 },
      journeyProgress: 0.36
    });
    const startOfSecondEdge = deliveryStatusCopy('in_transit', {
      connectivity: 'online', positionQuality: 'valid',
      position: { segmentId: 'edge-hss2-hss1', progress: 0.01 },
      journeyProgress: 0.37
    });

    expect(startOfSecondEdge.metrics.progressPercent)
      .toBeGreaterThanOrEqual(nearEndOfFirstEdge.metrics.progressPercent);
  });

  it('states an arrival estimate only when one was given', () => {
    const overlay = {
      connectivity: 'online', positionQuality: 'valid',
      position: { segmentId: 'edge-a', progress: 0.5 }, journeyProgress: 0.5
    };
    // 還估不出來的時候要說「估算中」，不要留白 —— 留白會被當成畫面壞了，
    // 而編一個數字比留白更糟。
    expect(deliveryStatusCopy('dispatching', overlay).metrics.eta).toBeNull();
    expect(deliveryStatusCopy('dispatching', overlay).detail).toContain('需要再觀察');
    expect(deliveryStatusCopy('dispatching', { ...overlay, etaSeconds: 120 }).metrics.eta)
      .toContain('2 分鐘');
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
