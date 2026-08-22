export const ROUTE_GRAPH_VERSION = 'ndhu-four-stop-route-v4';

export const ROUTE_NODES = Object.freeze([
  // Only four public stop nodes are visible. The remaining nodes are bends in
  // the one approved route, never extra stops or decorative roads.
  { id: 'LIBRARY', x: 735, y: 105 },
  { id: 'TRUNK_NORTH', x: 520, y: 105 },
  { id: 'TRUNK_HSS', x: 520, y: 315 },
  { id: 'HSS_JUNCTION', x: 385, y: 315 },
  { id: 'HSS2_TURN', x: 385, y: 205 },
  { id: 'HSS2', x: 225, y: 205 },
  { id: 'HSS1_TURN', x: 385, y: 425 },
  { id: 'HSS1', x: 225, y: 425 },
  { id: 'TRUNK_SOUTH', x: 520, y: 515 },
  { id: 'ADMIN_TURN', x: 650, y: 515 },
  { id: 'ADMIN', x: 835, y: 515 }
]);

const nodeById = new Map(ROUTE_NODES.map((node) => [node.id, node]));

function edge(id, fromNodeId, toNodeId) {
  const from = nodeById.get(fromNodeId);
  const to = nodeById.get(toNodeId);
  if (!from || !to) throw new Error(`Unknown route node in ${id}`);
  return Object.freeze({
    id,
    fromNodeId,
    toNodeId,
    svgPathD: `M ${from.x} ${from.y} L ${to.x} ${to.y}`,
    length: Math.hypot(to.x - from.x, to.y - from.y),
    directionPolicy: 'bidirectional'
  });
}

export const ROUTE_EDGES = Object.freeze([
  edge('edge-north-library', 'TRUNK_NORTH', 'LIBRARY'),
  edge('edge-trunk-north', 'TRUNK_HSS', 'TRUNK_NORTH'),
  edge('edge-hss-junction', 'TRUNK_HSS', 'HSS_JUNCTION'),
  edge('edge-hss2-turn', 'HSS_JUNCTION', 'HSS2_TURN'),
  edge('edge-hss2', 'HSS2_TURN', 'HSS2'),
  edge('edge-hss1-turn', 'HSS_JUNCTION', 'HSS1_TURN'),
  edge('edge-hss1', 'HSS1_TURN', 'HSS1'),
  edge('edge-trunk-south', 'TRUNK_HSS', 'TRUNK_SOUTH'),
  edge('edge-admin-turn', 'TRUNK_SOUTH', 'ADMIN_TURN'),
  edge('edge-admin', 'ADMIN_TURN', 'ADMIN')
]);

export const DELIVERY_LOCATIONS = Object.freeze([
  { code: 'LIBRARY', name: '圖資中心', detail: '圖資大樓正門・公車站前', routeNodeId: 'LIBRARY', active: true },
  { code: 'ADMIN', name: '行政大樓', detail: '郵局旁', routeNodeId: 'ADMIN', active: true },
  { code: 'HSS1', name: '人社一館', detail: '人社院南側取放點', routeNodeId: 'HSS1', active: true },
  { code: 'HSS2', name: '人社二館', detail: '人社院北側取放點', routeNodeId: 'HSS2', active: true }
]);

/** @param {string} code */
export function locationByCode(code) {
  return DELIVERY_LOCATIONS.find((location) => location.code === code) ?? null;
}

/**
 * Returns an oriented shortest path while preserving each edge's canonical direction.
 * @param {string} fromNodeId
 * @param {string} toNodeId
 */
export function shortestRoute(fromNodeId, toNodeId) {
  if (!nodeById.has(fromNodeId) || !nodeById.has(toNodeId)) return [];
  /** @type {Map<string, Array<{edge: typeof ROUTE_EDGES[number], next: string, forward: boolean}>>} */
  const adjacency = new Map();
  for (const node of ROUTE_NODES) adjacency.set(node.id, []);
  for (const item of ROUTE_EDGES) {
    adjacency.get(item.fromNodeId)?.push({ edge: item, next: item.toNodeId, forward: true });
    adjacency.get(item.toNodeId)?.push({ edge: item, next: item.fromNodeId, forward: false });
  }

  const distances = new Map(ROUTE_NODES.map((node) => [node.id, Number.POSITIVE_INFINITY]));
  const previous = new Map();
  const open = new Set(ROUTE_NODES.map((node) => node.id));
  distances.set(fromNodeId, 0);

  while (open.size) {
    const current = [...open].sort((a, b) => (distances.get(a) ?? Infinity) - (distances.get(b) ?? Infinity))[0];
    open.delete(current);
    if (current === toNodeId) break;
    for (const option of adjacency.get(current) ?? []) {
      if (!open.has(option.next)) continue;
      const candidate = (distances.get(current) ?? Infinity) + option.edge.length;
      if (candidate < (distances.get(option.next) ?? Infinity)) {
        distances.set(option.next, candidate);
        previous.set(option.next, { previousNode: current, ...option });
      }
    }
  }

  const route = [];
  let cursor = toNodeId;
  while (cursor !== fromNodeId) {
    const step = previous.get(cursor);
    if (!step) return [];
    route.unshift({
      edgeId: step.edge.id,
      fromNodeId: step.previousNode,
      toNodeId: cursor,
      forward: step.forward,
      length: step.edge.length
    });
    cursor = step.previousNode;
  }
  return route;
}

/**
 * @param {ReturnType<typeof shortestRoute>} route
 * @param {number} overallProgress
 */
export function positionAlongRoute(route, overallProgress) {
  if (!route.length) return null;
  const clamped = Math.max(0, Math.min(1, overallProgress));
  const total = route.reduce((sum, part) => sum + part.length, 0);
  let distance = clamped * total;
  for (const [index, part] of route.entries()) {
    if (distance <= part.length || index === route.length - 1) {
      const local = Math.max(0, Math.min(1, distance / part.length));
      return {
        segmentId: part.edgeId,
        progress: part.forward ? local : 1 - local
      };
    }
    distance -= part.length;
  }
  return null;
}

export function assertRouteGraphIntegrity() {
  const edgeEndpoints = new Set(ROUTE_EDGES.flatMap((item) => [item.fromNodeId, item.toNodeId]));
  for (const location of DELIVERY_LOCATIONS) {
    if (!edgeEndpoints.has(location.routeNodeId)) throw new Error(`${location.code} is not on a route endpoint`);
  }
  if (new Set(DELIVERY_LOCATIONS.map((location) => location.code)).size !== 4) {
    throw new Error('Expected exactly four unique delivery locations');
  }
  return true;
}
