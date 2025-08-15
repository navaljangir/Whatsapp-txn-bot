const initSqlJs = require("sql.js");
const fs = require("fs");
const path = require("path");

class TransactionDao {
  constructor(dbPath = path.join(__dirname, "..", "transactions.db")) {
    this.dbPath = dbPath;
    this.db = null;
    this.SQL = null;
  }

  async init() {
    try {
      this.SQL = await initSqlJs();
      if (fs.existsSync(this.dbPath)) {
        const fileBuffer = fs.readFileSync(this.dbPath);
        this.db = new this.SQL.Database(fileBuffer);
        console.log('Loaded existing database');
      } else {
        this.db = new this.SQL.Database();
        console.log('Created new database');
      }
      this.createTable();
    } catch (error) {
      console.error('Error initializing database:', error);
      throw error;
    }
  }

  createTable() {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    
    const sql = `
      CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY,
        phone_number TEXT NOT NULL,
        amount REAL NOT NULL,
        details TEXT,
        date TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_phone_number ON transactions(phone_number);
      CREATE INDEX IF NOT EXISTS idx_date ON transactions(date);
      CREATE INDEX IF NOT EXISTS idx_phone_date ON transactions(phone_number, date);
    `;
    this.db.run(sql);
    this.save();
  }

  save() {
    const data = this.db.export();
    fs.writeFileSync(this.dbPath, Buffer.from(data));
  }

  addTransaction(phoneNumber, amount, details = null) {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    
    const date = new Date().toISOString();
    this.db.run(
      `INSERT INTO transactions (phone_number, amount, details, date) VALUES (?, ?, ?, ?)`,
      [phoneNumber, amount, details, date]
    );
    this.save();
    return { phoneNumber, amount, details, date };
  }

  getTotalSent(phoneNumber) {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    
    const stmt = this.db.prepare(
      `SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE phone_number = ?`
    );
    stmt.bind([phoneNumber]);
    let total = 0;
    if (stmt.step()) {
      total = stmt.getAsObject().total;
    }
    stmt.free();
    return total;
  }

  getLastTransaction(phoneNumber) {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    
    const stmt = this.db.prepare(
      `SELECT * FROM transactions WHERE phone_number = ? ORDER BY created_at DESC LIMIT 1`
    );
    stmt.bind([phoneNumber]);
    let row = null;
    if (stmt.step()) {
      row = stmt.getAsObject();
    }
    stmt.free();
    return row;
  }

  getTransactionsByDate(phoneNumber, targetDate) {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    const stmt = this.db.prepare(
      `SELECT * FROM transactions 
       WHERE phone_number = ? 
       AND datetime(date) >= datetime(?) 
       AND datetime(date) <= datetime(?) 
       ORDER BY created_at DESC`
    );
    stmt.bind([
      phoneNumber,
      startOfDay.toISOString(),
      endOfDay.toISOString(),
    ]);

    const results = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
  }

  getTransactionsByPeriod(phoneNumber, amount, unit) {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    
    const cutoffDate = new Date();
    switch (unit.toLowerCase()) {
      case "d":
        cutoffDate.setDate(cutoffDate.getDate() - (amount - 1));
        break;
      case "m":
        cutoffDate.setMonth(cutoffDate.getMonth() - amount);
        break;
      case "y":
        cutoffDate.setFullYear(cutoffDate.getFullYear() - amount);
        break;
      default:
        throw new Error("Invalid unit");
    }
    cutoffDate.setHours(0, 0, 0, 0);

    const stmt = this.db.prepare(
      `SELECT * FROM transactions 
       WHERE phone_number = ? 
       AND datetime(date) >= datetime(?) 
       ORDER BY created_at DESC`
    );
    stmt.bind([phoneNumber, cutoffDate.toISOString()]);

    const results = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
  }

  getTransactionsByMonth(phoneNumber, month, year = null) {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    
    const currentYear = new Date().getFullYear();
    const targetYear = year
      ? year.toString().length === 2
        ? 2000 + parseInt(year)
        : parseInt(year)
      : currentYear;

    const startDate = new Date(targetYear, month - 1, 1);
    const endDate = new Date(targetYear, month, 0, 23, 59, 59, 999);

    const stmt = this.db.prepare(
      `SELECT * FROM transactions 
       WHERE phone_number = ? 
       AND datetime(date) >= datetime(?) 
       AND datetime(date) <= datetime(?) 
       ORDER BY created_at DESC`
    );
    stmt.bind([
      phoneNumber,
      startDate.toISOString(),
      endDate.toISOString(),
    ]);

    const results = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
  }

  close() {
    if (this.db) {
      this.save();
      this.db.close();
    }
  }
}

module.exports = TransactionDao;
