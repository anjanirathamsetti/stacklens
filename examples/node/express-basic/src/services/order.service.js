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

/**
 * Sales report over many line items. Calls pricing.lineTotal (and through it the catalog
 * repository) once per item: with 10,000 items StackLens records the first 10 calls in full and
 * folds the rest into one row with call stats.
 */
exports.buildReport = (itemCount) => {
  let totalCents = 0;
  let skipped = 0;
  for (let i = 0; i < itemCount; i++) {
    // every 2,500th item references a discontinued SKU
    const item = { sku: i % 2500 === 2499 ? `sku-gone-${i}` : `sku-${i % 500}`, qty: 1 + (i % 3) };
    try {
      totalCents += pricing.lineTotal(item);
    } catch {
      skipped++;
    }
  }
  return { items: itemCount, skipped, total: totalCents / 100 };
};
