const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class NotificationService {
  async orderCreated(user, order) {
    await sleep(5);
    return this.sendEmail(user.email, `Order #${order.id} confirmed`, { password: 'should-be-redacted' });
  }
  async sendEmail(to, subject, _meta) {
    await sleep(8);
    return { delivered: true, to, subject };
  }
}

module.exports = new NotificationService();
