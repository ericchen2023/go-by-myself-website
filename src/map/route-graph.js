import routeGraph from '../../contracts/route-graph.v5.json';

export const ROUTE_GRAPH_VERSION = routeGraph.version;
export const ROUTE_GRAPH_CHECKSUM = routeGraph.checksum;

export const ROUTE_NODES = Object.freeze(routeGraph.nodes.map((node) => Object.freeze({ ...node })));

const nodeById = new Map(ROUTE_NODES.map((node) => [node.id, node]));

/**
 * An edge is a polyline, not a straight line: the canonical graph carries the
 * surveyed shape of the road between two stops. Length is measured along that
 * polyline so shortest-path and progress agree with what is drawn.
 * @param {[number, number][]} vertices
 */
function pathFrom(vertices) {
  const [head, ...rest] = vertices;
  return rest.reduce((path, point) => `${path} L ${point[0]} ${point[1]}`, `M ${head[0]} ${head[1]}`);
}

function edge(id, fromNodeId, toNodeId, points = []) {
  const from = nodeById.get(fromNodeId);
  const to = nodeById.get(toNodeId);
  if (!from || !to) throw new Error(`Unknown route node in ${id}`);
  const vertices = /** @type {[number, number][]} */ ([[from.x, from.y], ...points.map((point) => [point[0], point[1]]), [to.x, to.y]]);
  let length = 0;
  for (let index = 1; index < vertices.length; index += 1) {
    length += Math.hypot(vertices[index][0] - vertices[index - 1][0], vertices[index][1] - vertices[index - 1][1]);
  }
  return Object.freeze({
    id,
    fromNodeId,
    toNodeId,
    vertices: Object.freeze(vertices.map((point) => Object.freeze([...point]))),
    svgPathD: pathFrom(vertices),
    length,
    directionPolicy: 'bidirectional'
  });
}

export const ROUTE_EDGES = Object.freeze(routeGraph.edges.map((item) => edge(item.id, item.fromNodeId, item.toNodeId, item.points)));

const edgeById = new Map(ROUTE_EDGES.map((item) => [item.id, item]));

/**
 * The drawn path for one edge, oriented the way it is travelled. Callers must
 * not rebuild this from node coordinates: an edge's shape lives only here.
 * @param {string} edgeId
 * @param {boolean} forward
 */
export function edgePathD(edgeId, forward = true) {
  const item = edgeById.get(edgeId);
  if (!item) return '';
  const vertices = forward ? item.vertices : [...item.vertices].reverse();
  return pathFrom(/** @type {[number, number][]} */ (vertices));
}

/**
 * Where a progress fraction lands on an edge's polyline, and which way the road
 * points there. Interpolating between the two endpoints instead would put the
 * marker off the drawn road wherever the road bends.
 * @param {string} edgeId
 * @param {number} progress
 */
export function pointAlongEdge(edgeId, progress) {
  const item = edgeById.get(edgeId);
  if (!item || !item.length) return null;
  const target = Math.max(0, Math.min(1, progress)) * item.length;
  let traveled = 0;
  for (let index = 1; index < item.vertices.length; index += 1) {
    const [x0, y0] = item.vertices[index - 1];
    const [x1, y1] = item.vertices[index];
    const span = Math.hypot(x1 - x0, y1 - y0);
    if (traveled + span >= target || index === item.vertices.length - 1) {
      const local = span === 0 ? 0 : (target - traveled) / span;
      return {
        x: x0 + (x1 - x0) * local,
        y: y0 + (y1 - y0) * local,
        headingDeg: Math.atan2(y1 - y0, x1 - x0) * (180 / Math.PI)
      };
    }
    traveled += span;
  }
  return null;
}

/**
 * One continuous path across an oriented route, used for motion along the whole journey.
 * @param {Array<{edgeId: string, forward: boolean}>} parts
 */
export function routePathD(parts) {
  if (!parts.length) return '';
  const vertices = [];
  for (const part of parts) {
    const item = edgeById.get(part.edgeId);
    if (!item) continue;
    const ordered = part.forward ? item.vertices : [...item.vertices].reverse();
    vertices.push(...(vertices.length ? ordered.slice(1) : ordered));
  }
  return vertices.length ? pathFrom(/** @type {[number, number][]} */ (vertices)) : '';
}

/**
 * Where the schematic vehicle waits before a pickup leg exists. v4 used a trunk
 * junction node; v5 has only the four stops, so this has to be one of them, and
 * both the demo adapter and the status map must agree on which.
 */
export const VEHICLE_STAGING_NODE_ID = 'HSS1';
export const VEHICLE_STAGING_ALTERNATE_NODE_ID = 'LIBRARY';

/** @param {string} pickupNodeId */
export function stagingOriginFor(pickupNodeId) {
  return pickupNodeId === VEHICLE_STAGING_NODE_ID ? VEHICLE_STAGING_ALTERNATE_NODE_ID : VEHICLE_STAGING_NODE_ID;
}

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
