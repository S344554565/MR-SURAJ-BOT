const db = require('../index');

const Users = {
  getAll() {
    return db.prepare('SELECT * FROM users').all();
  },

  get(id) {
    return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  },

  create(id, name = '') {
    const existing = this.get(id);
    if (existing) return existing;
    
    db.prepare('INSERT INTO users (id, name) VALUES (?, ?)').run(id, name);
    return this.get(id);
  },

  update(id, data) {
    const user = this.get(id);
    if (!user) this.create(id);
    
    const fields = [];
    const values = [];
    
    for (const [key, value] of Object.entries(data)) {
      fields.push(`${key} = ?`);
      values.push(typeof value === 'object' ? JSON.stringify(value) : value);
    }
    
    values.push(id);
    db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return this.get(id);
  },

  setName(id, name) {
    return this.update(id, { name });
  },

  getName(id) {
    const user = this.get(id);
    return user?.name || 'Unknown';
  },

  ban(id, reason = '') {
    // Store with both formats
    this.update(String(id), { banned: 1, banReason: reason });
    this.update(parseInt(id), { banned: 1, banReason: reason });
    return this.update(id, { banned: 1, banReason: reason });
  },

  unban(id) {
    // Try all ID formats
    this.update(String(id), { banned: 0, banReason: '' });
    this.update(parseInt(id), { banned: 0, banReason: '' });
    this.update(id, { banned: 0, banReason: '' });
    return true;
  },

  isBanned(id) {
    // Try string, number, and parseInt versions
    const userStr = this.get(String(id));
    if (userStr && userStr.banned === 1) return true;
    
    const userNum = this.get(parseInt(id));
    if (userNum && userNum.banned === 1) return true;
    
    const userDirect = this.get(id);
    if (userDirect && userDirect.banned === 1) return true;
    
    return false;
  },

  addExp(id, amount) {
    const user = this.get(id) || this.create(id);
    return this.update(id, { exp: (user.exp || 0) + amount });
  },

  addMoney(id, amount) {
    const user = this.get(id) || this.create(id);
    return this.update(id, { money: (user.money || 0) + amount });
  },

  getData(id) {
    const user = this.get(id);
    try {
      return JSON.parse(user?.data || '{}');
    } catch {
      return {};
    }
  },

  setData(id, data) {
    return this.update(id, { data: JSON.stringify(data) });
  },

  getBanned() {
    try {
      return db.prepare('SELECT * FROM users WHERE banned = 1').all();
    } catch {
      return [];
    }
  }
};

module.exports = Users;
