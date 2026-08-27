import routeGraph from '../../contracts/route-graph.v4.json';

export const ROUTE_GRAPH_VERSION = routeGraph.version;
export const ROUTE_GRAPH_CHECKSUM = routeGraph.checksum;

export const ROUTE_NODES = Object.freeze(routeGraph.nodes.map((node) => Object.freeze({ ...node })));

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

export const ROUTE_EDGES = Object.freeze(routeGraph.edges.map((item) => edge(item.id, item.fromNodeId, item.toNodeId)));

export const DELIVERY_LOCATIONS = Object.freeze(routeGraph.locations.map((location) => Object.freeze({ ...location })));

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
