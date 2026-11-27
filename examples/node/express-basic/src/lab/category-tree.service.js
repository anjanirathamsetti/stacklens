// Recursion: walk a category tree. Every node is its own parent, so siblings stay below the
// collapse threshold – a deep tree shows the maxSpansPerTrace backstop instead.
// GET /api/lab/categories/tree?depth=4&breadth=4   (depth 6 → truncated trace)
const { categoryRepo } = require('./lab.repository');

class CategoryMetrics {
  weight(node) {
    return node.id.length;
  }
}

class CategoryTreeService {
  constructor(metrics) {
    this.metrics = metrics;
  }
  walk(node, breadth) {
    const kids = categoryRepo.children(node, breadth);
    let nodes = 1;
    let weight = this.metrics.weight(node);
    for (const kid of kids) {
      const r = this.walk(kid, breadth);
      nodes += r.nodes;
      weight += r.weight;
    }
    return { nodes, weight };
  }
  tree(depth, breadth) {
    return this.walk({ id: 'root', depth: 0, maxDepth: depth }, breadth);
  }
}

module.exports = { categoryTree: new CategoryTreeService(new CategoryMetrics()), CategoryTreeService, CategoryMetrics };
