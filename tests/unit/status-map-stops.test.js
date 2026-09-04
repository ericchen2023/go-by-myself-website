// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createRouteSelector } from '../../src/map/map-view.js';
import { journeyToDraw } from '../../src/map/route-graph.js';

/** @param {boolean} onlyDeliveryStops */
function render(onlyDeliveryStops) {
  return createRouteSelector({
    id: 'probe', label: '測試', interactive: false,
    pickupCode: 'LIBRARY', dropoffCode: 'ADMIN',
    activeEdgeIds: [],
    activeRouteParts: journeyToDraw({ pickupCode: 'LIBRARY', dropoffCode: 'ADMIN' }).parts,
    vehiclePosition: null,
    onlyDeliveryStops
  });
}

const codes = (node, selector) =>
  [...node.querySelectorAll(selector)].map((item) => item.getAttribute('data-location-code')).sort();

describe('which stops the status map shows', () => {
  it('keeps only the stops this delivery uses', () => {
    const node = render(true);

    expect(codes(node, '.map-stop')).toEqual(['ADMIN', 'LIBRARY']);
    expect([...node.querySelectorAll('.map-station-label')].map((label) => label.textContent))
      .toEqual(['圖資中心', '行政大樓']);
  });

  it('takes the approach stubs with the stops they belong to', () => {
    // 那兩條灰色短線只屬於人社一／二館 —— 它們是離主幹道退後的站，
    // 圖資中心與行政大樓直接在幹道上，本來就沒有短線。
    const withEveryStop = render(false);
    const deliveryOnly = render(true);

    expect(codes(withEveryStop, '.stop-approach')).toEqual(['HSS1', 'HSS2']);
    expect(codes(deliveryOnly, '.stop-approach')).toEqual([]);
  });

  it('still draws the whole corridor, so the route does not look broken', () => {
    // 隱藏的是站點，不是路。只畫用到的路段會讓其他道路整條消失。
    const node = render(true);

    expect(node.querySelectorAll('.route-edge')).toHaveLength(3);
    expect(node.querySelectorAll('.route-edge.is-active')).toHaveLength(3);
  });

  it('shows every stop when the caller did not ask to hide any', () => {
    // 選站的地圖與營運端的驗證頁都需要四站 —— 後者同樣是非互動的，所以這個
    // 行為不能從 interactive 推論出來。
    const node = render(false);

    expect(codes(node, '.map-stop')).toEqual(['ADMIN', 'HSS1', 'HSS2', 'LIBRARY']);
  });
});
