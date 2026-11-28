const billingClient = require('../clients/billing.client');
const shippingClient = require('../clients/shipping.client');

class CheckoutService {
  /**
   * Look up the customer's invoice in billing-api (runs StackLens), get a shipping quote from
   * shipping-service (doesn't), then place the order in billing-api.
   */
  async checkout(userId, items, zip = '94107') {
    const invoice = await billingClient.getInvoice(userId);
    const shipping = await shippingClient.quote(zip, items);
    const amount = +(this.total(items) + shipping.price).toFixed(2);
    const order = await billingClient.createOrder(userId, amount);
    return { invoice, shipping, order, amount };
  }

  /** Streams a label from shipping-service. */
  label(orderId) {
    return shippingClient.label(`ord-${orderId}`);
  }

  total(items) {
    return +items.reduce((sum, i) => sum + i.price * i.qty, 0).toFixed(2);
  }
}

module.exports = new CheckoutService();
