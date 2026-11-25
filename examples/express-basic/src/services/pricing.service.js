const TAX = 0.08;

exports.quote = (items) => {
  const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
  const tax = module.exports.tax(subtotal);
  return { subtotal, tax, total: +(subtotal + tax).toFixed(2) };
};

exports.tax = (amount) => +(amount * TAX).toFixed(2);

exports.assertRefundable = (order) => {
  if (!order || order.status !== 'paid') {
    throw new Error(`Order ${order ? order.id : '?'} is not refundable (status=${order && order.status})`);
  }
};
