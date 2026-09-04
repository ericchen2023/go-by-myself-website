import { describe, expect, it } from 'vitest';
import { createRoutePreview, createRouteSelector } from '../../src/map/map-view.js';

function expectCorridorPaintedAboveApproaches(view) {
  const svg = view.querySelector('.route-map, svg');
  const layers = [...svg.children];
  const approachIndex = layers.findIndex((layer) => layer.classList?.contains('approach-layer'));
  const routeIndex = layers.findIndex((layer) => layer.classList?.contains('route-layer'));

  expect(approachIndex).toBeGreaterThan(-1);
  expect(routeIndex).toBeGreaterThan(-1);
  expect(approachIndex).toBeLessThan(routeIndex);
}

describe('public route junctions', () => {
  it('keeps the main corridor continuous above the HSS approach halos', () => {
    expectCorridorPaintedAboveApproaches(createRoutePreview());
    expectCorridorPaintedAboveApproaches(createRouteSelector({
      id: 'test-route',
      label: '選擇站點',
      interactive: true
    }));
  });

  it('tells users why the pickup and an untaught pair are different restrictions', () => {
    const selector = createRouteSelector({
      id: 'test-dropoff',
      label: '選擇收件地點',
      pickupCode: 'LIBRARY',
      disabledCodes: ['LIBRARY', 'HSS1'],
      interactive: true
    });

    expect(selector.querySelector('.map-stop[data-location-code="LIBRARY"]')?.getAttribute('aria-label'))
      .toContain('與放件地點相同');
    expect(selector.querySelector('.map-stop[data-location-code="HSS1"]')?.getAttribute('aria-label'))
      .toContain('車端尚未支援這組直達路線');
  });
});
