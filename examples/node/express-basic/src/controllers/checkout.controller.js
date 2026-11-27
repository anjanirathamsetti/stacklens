const checkoutService = require('../services/checkout.service');

exports.checkout = async (req, res) => {
  const items = Array.isArray(req.body?.items) && req.body.items.length ? req.body.items : [{ sku: 'kb-01', price: 49.5, qty: 1 }];
  res.status(201).json(await checkoutService.checkout(Number(req.params.userId), items));
};
