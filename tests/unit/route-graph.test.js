import { describe, expect, it } from 'vitest';
import { assertRouteGraphIntegrity, DELIVERY_LOCATIONS, positionAlongRoute, ROUTE_EDGES, ROUTE_NODES, shortestRoute } from '../../src/map/route-graph.js';
import { markerPointForPosition } from '../../src/map/map-view.js';

const nodeById = new Map(ROUTE_NODES.map((node) => [node.id, node]));
const edgeById = new Map(ROUTE_EDGES.map((edge) => [edge.id, edge]));

/**
 * Perpendicular distance from a point to the straight chord between two vertices.
 * @param {{x: number, y: number}} point
 * @param {readonly number[]} from
 * @param {readonly number[]} to
 */
function distanceToChord(point, from, to) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  return Math.abs(dy * (point.x - from[0]) - dx * (point.y - from[1])) / Math.hypot(dx, dy);
}

describe('canonical route graph', () => {
  it('contains exactly four delivery stops attached to route endpoints', () => {
    expect(assertRouteGraphIntegrity()).toBe(true);
    expect(DELIVERY_LOCATIONS.map((location) => location.code)).toEqual(['LIBRARY', 'HSS2', 'HSS1', 'ADMIN']);
  });

  it('finds a connected route between every stop pair', () => {
    for (const from of DELIVERY_LOCATIONS) {
      for (const to of DELIVERY_LOCATIONS) {
        if (from === to) continue;
        expect(shortestRoute(from.routeNodeId, to.routeNodeId).length).toBeGreaterThan(0);
      }
    }
  });

  it('places the four stops along one surveyed corridor', () => {
    expect(ROUTE_NODES).toHaveLength(4);
    expect(ROUTE_EDGES).toHaveLength(3);
    const corridor = ['LIBRARY', 'HSS2', 'HSS1', 'ADMIN'].map((code) => nodeById.get(code));
    for (let index = 1; index < corridor.length; index += 1) {
      expect(corridor[index].x).toBeGreaterThan(corridor[index - 1].x);
    }
    expect(nodeById.get('ADMIN').y).toBeLessThan(nodeById.get('HSS1').y);
    expect(nodeById.get('HSS1').y).toBeLessThan(nodeById.get('LIBRARY').y);
    expect(ROUTE_NODES.some((node) => node.id.startsWith('P_'))).toBe(false);
  });

  it('drives past both HSS stops on the way from the library to admin', () => {
    // v4 modelled HSS1/HSS2 as spurs off a trunk, so this plan skipped them and
    // a car on the real road was drawn on a segment it never travelled.
    const edges = shortestRoute('LIBRARY', 'ADMIN').map((part) => part.edgeId);
    expect(edges).toEqual(['edge-library-hss2', 'edge-hss2-hss1', 'edge-hss1-admin']);
  });

  it('measures each edge along its polyline rather than its chord', () => {
    for (const edge of ROUTE_EDGES) {
      const from = nodeById.get(edge.fromNodeId);
      const to = nodeById.get(edge.toNodeId);
      expect(edge.vertices.length).toBeGreaterThan(2);
      expect(edge.length).toBeGreaterThan(Math.hypot(to.x - from.x, to.y - from.y));
    }
  });

  it('keeps the marker on the road where the road bends', () => {
    const edge = edgeById.get('edge-library-hss2');
    const start = edge.vertices[0];
    const end = edge.vertices[edge.vertices.length - 1];
    const offChord = [0.1, 0.2, 0.3]
      .map((progress) => markerPointForPosition({ segmentId: edge.id, progress }))
      .map((point) => distanceToChord(point, start, end));
    // Interpolating between the endpoints would put every one of these exactly
    // on the chord; the surveyed road leaves it near the library forecourt.
    expect(Math.max(...offChord)).toBeGreaterThan(5);
  });

  it.each([0, 0.25, 0.5, 0.75, 1])('keeps marker on canonical edge at progress %s', (progress) => {
    const route = shortestRoute('HSS1', 'LIBRARY');
    const position = positionAlongRoute(route, progress);
    expect(position).not.toBeNull();
    const point = markerPointForPosition(position);
    expect(point).not.toBeNull();
    expect(edgeById.has(position.segmentId)).toBe(true);
    expect(Number.isFinite(point.x)).toBe(true);
    expect(Number.isFinite(point.y)).toBe(true);
  });
});
