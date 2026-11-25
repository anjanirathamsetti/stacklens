// Tiny fake async DB
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tables = {
  users: [
    { id: 1, name: 'Ada Lovelace', email: 'ada@example.com', roles: ['admin'], createdAt: new Date('2024-01-02') },
    { id: 2, name: 'Alan Turing', email: 'alan@example.com', roles: ['user'], createdAt: new Date('2024-03-12') },
  ],
  orders: [
    { id: 1, userId: 1, total: 120.5, status: 'paid' },
    { id: 2, userId: 1, total: 42, status: 'pending' },
    { id: 3, userId: 2, total: 9.99, status: 'paid' },
  ],
};
module.exports = { tables, sleep };
