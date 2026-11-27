const { Router } = require('express');
const orderController = require('./controllers/order.controller');
const userController = require('./controllers/user.controller');
const labController = require('./lab/lab.controller');

const r = Router();
// Go through the exports object so the instrumented versions are used
r.get('/users/:id', (req, res, next) => userController.getUser(req, res).catch(next));
r.get('/orders/report', (req, res, next) => orderController.report(req, res).catch(next));
r.get('/orders', (req, res, next) => orderController.list(req, res).catch(next));
r.post('/orders', (req, res, next) => orderController.create(req, res).catch(next));
r.get('/orders/:id/fail', (req, res, next) => orderController.fail(req, res).catch(next));

// Heavy endpoints for trying StackLens on big call trees (see src/lab)
r.get('/lab/catalog-sync', (req, res, next) => labController.catalogSync(req, res).catch(next));
r.get('/lab/feed/:userId', (req, res, next) => labController.feed(req, res).catch(next));
r.get('/lab/categories/tree', (req, res, next) => labController.categoryTree(req, res).catch(next));
r.post('/lab/invoices/run', (req, res, next) => labController.invoiceRun(req, res).catch(next));
module.exports = r;
