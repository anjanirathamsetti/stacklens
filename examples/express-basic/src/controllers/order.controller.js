const orderService = require('../services/order.service');
const createOrderHandler = require('../handlers/create-order.handler');

exports.list = async (req, res) => {
  const orders = await orderService.listForUser(Number(req.query.userId || 1), { status: req.query.status });
  res.json({ data: orders, count: orders.length });
};

exports.create = async (req, res) => {
  const order = await createOrderHandler.execute(req.body, { actorId: 1 });
  res.status(201).json(order);
};

exports.fail = async (req) => {
  await orderService.refund(Number(req.params.id));
};
