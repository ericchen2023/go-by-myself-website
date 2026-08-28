export function routePairs(graph) {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const edges = graph.edges.map((edge) => {
    const from = nodes.get(edge.fromNodeId);
    const to = nodes.get(edge.toNodeId);
    return { ...edge, length: Math.hypot(to.x - from.x, to.y - from.y) };
  });
  const adjacency = new Map(graph.nodes.map((node) => [node.id, []]));
  for (const edge of edges) {
    adjacency.get(edge.fromNodeId).push({ edge, next: edge.toNodeId });
    adjacency.get(edge.toNodeId).push({ edge, next: edge.fromNodeId });
  }
  const shortest = (fromNodeId, toNodeId) => {
    const distances = new Map(graph.nodes.map((node) => [node.id, Number.POSITIVE_INFINITY]));
    const previous = new Map();
    const open = new Set(nodes.keys());
    distances.set(fromNodeId, 0);
    while (open.size) {
      const current = [...open].sort((left, right) => distances.get(left) - distances.get(right))[0];
      open.delete(current);
      if (current === toNodeId) break;
      for (const option of adjacency.get(current)) {
        if (!open.has(option.next)) continue;
        const candidate = distances.get(current) + option.edge.length;
        if (candidate < distances.get(option.next)) {
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
      route.unshift(step.edge.id);
      cursor = step.previousNode;
    }
    return route;
  };
  const pairs = [];
  for (const from of graph.locations) {
    for (const to of graph.locations) {
      if (from.code === to.code) continue;
      pairs.push({ from: from.code, to: to.code, edges: shortest(from.routeNodeId, to.routeNodeId) });
    }
  }
  return pairs;
}

export function routePairSqlTuple(pair) {
  const edges = pair.edges.map((edge) => `'${edge}'`).join(',');
  return `('${pair.from}','${pair.to}',array[${edges}]::text[])`;
}
