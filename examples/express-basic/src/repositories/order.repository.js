const { tables, sleep } = require('./db');

class OrderRepository {
  async findByUser(userId) {
    await sleep(4 + Math.random() * 8);
    return tables.orders.filter((o) => o.userId === userId);
  }
  async findById(id) {
    await sleep(2 + Math.random() * 4);
    return tables.orders.find((o) => o.id === id) || null;
  }
  async insert(row) {
    await sleep(6 + Math.random() * 6);
    const order = { id: tables.orders.length + 1, ...row, createdAt: new Date() };
    tables.orders.push(order);
    return order;
  }
}
module.exports = new OrderRepository();
