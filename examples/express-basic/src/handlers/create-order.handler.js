const orderService = require('../services/order.service');
const orderRepository = require('../repositories/order.repository');
const userRepository = require('../repositories/user.repository');
const notifier = require('../services/notification.service');

class CreateOrderHandler {
  async execute(dto, _ctx) {
    const user = await userRepository.findById(dto.userId);
    if (!user) throw new Error('unknown user');
    const price = orderService.priceItems(dto.items);
    const order = await orderRepository.insert({ userId: user.id, items: dto.items, ...price, status: 'pending' });
    notifier.orderCreated(user, order); // fire and forget
    return order;
  }
}

module.exports = new CreateOrderHandler();
