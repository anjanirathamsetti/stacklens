const billingClient = require('../clients/billing.client');

class CheckoutService {
  /** Look up the customer's invoice in billing-api, then place a new order there. */
  async checkout(userId, items) {
    const invoice = await billingClient.getInvoice(userId);
    const amount = this.total(items);
    const order = await billingClient.createOrder(userId, amount);
    return { invoice, order, amount };
  }

  total(items) {
    return +items.reduce((sum, i) => sum + i.price * i.qty, 0).toFixed(2);
  }
}

module.exports = new CheckoutService();
