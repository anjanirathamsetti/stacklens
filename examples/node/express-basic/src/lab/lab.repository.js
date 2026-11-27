// In-memory data for the "lab" endpoints. Some lookups are async (like a real DB driver).
const { sleep } = require('../repositories/db');

const products = Array.from({ length: 2000 }, (_, i) => ({
  sku: `P-${String(i).padStart(5, '0')}`,
  name: `Product ${i}`,
  cents: 299 + ((i * 37) % 9000),
  currency: ['EUR', 'USD', 'GBP'][i % 3],
  stock: (i * 13) % 120,
}));
const authors = Array.from({ length: 300 }, (_, i) => ({ id: i + 1, name: `Author ${i + 1}`, verified: i % 4 === 0 }));

class InventoryRepository {
  findBySku(sku) {
    return products.find((p) => p.sku === sku) ?? null;
  }
  /** One write per item: the N+1 pattern on purpose. */
  async upsert(item) {
    if (item.qty % 97 === 0) await sleep(1); // occasional slow write
    return { sku: item.sku, stock: item.qty, updated: true };
  }
}

class AuthorRepository {
  async byId(id) {
    return authors[(id - 1) % authors.length];
  }
}

class PostRepository {
  async forUser(userId, limit) {
    await sleep(2);
    return Array.from({ length: limit }, (_, i) => ({
      id: userId * 1000 + i,
      authorId: ((userId * 7 + i) % 300) + 1,
      likes: (i * 11) % 250,
    }));
  }
}

class CategoryRepository {
  children(node, breadth) {
    if (node.depth >= node.maxDepth) return [];
    return Array.from({ length: breadth }, (_, i) => ({ id: `${node.id}.${i}`, depth: node.depth + 1, maxDepth: node.maxDepth }));
  }
}

module.exports = {
  products,
  inventory: new InventoryRepository(),
  authorRepo: new AuthorRepository(),
  postRepo: new PostRepository(),
  categoryRepo: new CategoryRepository(),
};
