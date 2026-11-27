// Endpoints that generate big call trees for trying out StackLens (loops, recursion, fan-out).
// Use the exports object (not destructured) so calls go through the instrumented methods
const catalogSyncModule = require('./catalog-sync.service');
const feedModule = require('./feed.service');
const categoryTreeModule = require('./category-tree.service');
const invoiceRunModule = require('./invoice-run.handler');

const int = (v, d, max) => Math.max(1, Math.min(max, Number(v) || d));

exports.catalogSync = async (req, res) => {
  res.json(await catalogSyncModule.catalogSync.run(int(req.query.batches, 20, 200), int(req.query.size, 250, 2000)));
};

exports.feed = async (req, res) => {
  res.json(await feedModule.feed.build(int(req.params.userId, 1, 1e6), int(req.query.friends, 40, 500)));
};

exports.categoryTree = async (req, res) => {
  res.json(categoryTreeModule.categoryTree.tree(int(req.query.depth, 4, 7), int(req.query.breadth, 4, 8)));
};

exports.invoiceRun = async (req, res) => {
  res.json(await invoiceRunModule.invoiceRun.execute(int(req.query.customers, 300, 5000)));
};
