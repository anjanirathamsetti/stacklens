const orderRepository = require('../repositories/order.repository');
const pricing = require('./pricing.service');

exports.listForUser = async (userId, filters) => {
  const orders = await orderRepository.findByUser(userId);
  return orders.filter((o) => !filters.status || o.status === filters.status);
};

exports.refund = async (orderId) => {
  const order = await orderRepository.findById(orderId);
  console.log('refunding order', { orderId, total: order && order.total });
  pricing.assertRefundable(order);
};

exports.priceItems = (items) => pricing.quote(items);
