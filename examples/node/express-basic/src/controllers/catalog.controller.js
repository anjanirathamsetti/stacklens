const catalogClient = require('../clients/catalog.client');

// Cross-language: these call catalog-api (Python, FastAPI) – see examples/python.
exports.product = async (req, res) => {
  res.json(await catalogClient.product(req.params.sku));
};

exports.quote = async (req, res) => {
  const items = Array.isArray(req.body?.items) && req.body.items.length ? req.body.items : [{ sku: 'kb-01', qty: 1 }];
  const quote = await catalogClient.quote(Number(req.params.userId), items);
  res.status(201).json({ quoteId: quote.id, total: quote.total, currency: quote.currency, lines: quote.lines?.length ?? 0 });
};
