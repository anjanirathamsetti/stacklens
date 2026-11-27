const userRepository = require('../repositories/user.repository');
const orderRepository = require('../repositories/order.repository');

class UserService {
  async getProfile(userId) {
    const user = await userRepository.findById(userId);
    if (!user) {
      const e = new Error(`User ${userId} not found`);
      e.status = 404;
      throw e;
    }
    const stats = await this.computeStats(userId);
    return { ...user, stats };
  }

  async computeStats(userId) {
    const orders = await orderRepository.findByUser(userId);
    return { orders: orders.length, lifetimeValue: this.sum(orders.map((o) => o.total)) };
  }

  sum(values) {
    return values.reduce((a, b) => a + b, 0);
  }
}

module.exports = new UserService();
