import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const graph = JSON.parse(readFileSync(resolve('contracts/route-graph.v4.json'), 'utf8'));
const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
const edges = graph.edges.map((item) => {
  const from = nodes.get(item.fromNodeId);
  const to = nodes.get(item.toNodeId);
  return { ...item, length: Math.hypot(to.x - from.x, to.y - from.y) };
});

export const ROUTE_GRAPH_VERSION = graph.version;
export const ROUTE_GRAPH_CHECKSUM = graph.checksum;

export function locationByCode(code) {
  return graph.locations.find((location) => location.code === code) ?? null;
}

export function shortestRoute(fromNodeId, toNodeId) {
  if (!nodes.has(fromNodeId) || !nodes.has(toNodeId)) return [];
  const adjacency = new Map(graph.nodes.map((node) => [node.id, []]));
  for (const edge of edges) {
    adjacency.get(edge.fromNodeId).push({ edge, next: edge.toNodeId, forward: true });
    adjacency.get(edge.toNodeId).push({ edge, next: edge.fromNodeId, forward: false });
  }
  const distance = new Map(graph.nodes.map((node) => [node.id, Number.POSITIVE_INFINITY]));
  const previous = new Map();
  const open = new Set(nodes.keys());
  distance.set(fromNodeId, 0);
  while (open.size) {
    const current = [...open].sort((left, right) => distance.get(left) - distance.get(right))[0];
    open.delete(current);
    if (current === toNodeId) break;
    for (const option of adjacency.get(current)) {
      if (!open.has(option.next)) continue;
      const candidate = distance.get(current) + option.edge.length;
      if (candidate < distance.get(option.next)) {
        distance.set(option.next, candidate);
        previous.set(option.next, { previousNode: current, ...option });
      }
    }
  }
  const route = [];
  let cursor = toNodeId;
  while (cursor !== fromNodeId) {
    const step = previous.get(cursor);
    if (!step) return [];
    route.unshift({ edgeId: step.edge.id, fromNodeId: step.previousNode, toNodeId: cursor, forward: step.forward, length: step.edge.length });
    cursor = step.previousNode;
  }
  return route;
}

export function positionAlongRoute(route, overallProgress) {
  if (!route.length) return null;
  const total = route.reduce((sum, part) => sum + part.length, 0);
  let remaining = Math.max(0, Math.min(1, overallProgress)) * total;
  for (const [index, part] of route.entries()) {
    if (remaining <= part.length || index === route.length - 1) {
      const local = Math.max(0, Math.min(1, remaining / part.length));
      return { segmentId: part.edgeId, progress: part.forward ? local : 1 - local };
    }
    remaining -= part.length;
  }
  return null;
}
