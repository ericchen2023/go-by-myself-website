import { describe, expect, it } from 'vitest';
import { assertRouteGraphIntegrity, DELIVERY_LOCATIONS, positionAlongRoute, ROUTE_EDGES, ROUTE_NODES, shortestRoute } from '../../src/map/route-graph.js';
import { markerPointForPosition } from '../../src/map/map-view.js';

describe('canonical route graph', () => {
  it('contains exactly four delivery stops attached to route endpoints', () => {
    expect(assertRouteGraphIntegrity()).toBe(true);
    expect(DELIVERY_LOCATIONS.map((location) => location.code)).toEqual(['LIBRARY', 'ADMIN', 'HSS1', 'HSS2']);
  });

  it('finds a connected route between every stop pair', () => {
    for (const from of DELIVERY_LOCATIONS) {
      for (const to of DELIVERY_LOCATIONS) {
        if (from === to) continue;
        expect(shortestRoute(from.routeNodeId, to.routeNodeId).length).toBeGreaterThan(0);
      }
    }
  });

  it('matches the supplied campus schematic topology', () => {
    const nodes = new Map(ROUTE_NODES.map((node) => [node.id, node]));
    expect(nodes.get('LIBRARY').y).toBeLessThan(nodes.get('HSS2').y);
    expect(nodes.get('HSS2').x).toBeLessThan(nodes.get('TRUNK_HSS').x);
    expect(nodes.get('HSS1').x).toBeLessThan(nodes.get('TRUNK_HSS').x);
    expect(nodes.get('HSS2').y).toBeLessThan(nodes.get('HSS1').y);
    expect(nodes.get('ADMIN').x).toBeGreaterThan(nodes.get('TRUNK_SOUTH').x);
    expect(nodes.get('ADMIN').y).toBeGreaterThan(nodes.get('HSS1').y);
    expect(ROUTE_NODES.some((node) => node.id.startsWith('P_'))).toBe(false);
  });

  it.each([0, 0.25, 0.5, 0.75, 1])('keeps marker on canonical edge at progress %s', (progress) => {
    const route = shortestRoute('TRUNK_HSS', 'LIBRARY');
    const position = positionAlongRoute(route, progress);
    expect(position).not.toBeNull();
    const point = markerPointForPosition(position);
    expect(point).not.toBeNull();
    const edge = ROUTE_EDGES.find((candidate) => candidate.id === position.segmentId);
    expect(edge).toBeDefined();
    expect(Number.isFinite(point.x)).toBe(true);
    expect(Number.isFinite(point.y)).toBe(true);
  });
});
