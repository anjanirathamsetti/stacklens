// In-memory product catalog. Looked up once per line item – an N+1 pattern on purpose,
// so the report endpoint shows how StackLens collapses calls made in a loop.
const catalog = new Map(Array.from({ length: 500 }, (_, i) => [`sku-${i}`, { sku: `sku-${i}`, cents: 199 + i, currency: 'EUR' }]));

exports.priceOf = (sku) => {
  const product = catalog.get(sku);
  if (!product) throw new Error(`Unknown SKU ${sku}`);
  return product;
};
