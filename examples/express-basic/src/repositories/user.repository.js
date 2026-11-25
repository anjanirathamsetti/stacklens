const { tables, sleep } = require('./db');

class UserRepository {
  async findById(id) {
    await sleep(3 + Math.random() * 6);
    return tables.users.find((u) => u.id === id) || null;
  }
}
module.exports = new UserRepository();
