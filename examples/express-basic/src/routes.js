const { Router } = require('express');
const orderController = require('./controllers/order.controller');
const userController = require('./controllers/user.controller');

const r = Router();
// Go through the exports object so the instrumented versions are used
r.get('/users/:id', (req, res, next) => userController.getUser(req, res).catch(next));
r.get('/orders', (req, res, next) => orderController.list(req, res).catch(next));
r.post('/orders', (req, res, next) => orderController.create(req, res).catch(next));
r.get('/orders/:id/fail', (req, res, next) => orderController.fail(req, res).catch(next));
module.exports = r;
