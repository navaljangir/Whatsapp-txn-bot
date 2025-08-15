const sqlite3 = require("sqlite3").verbose();
const path = require("path");

class TransactionDao {
  constructor(dbPath = path.join(__dirname, "..", "transactions.db")) {
    this.dbPath = dbPath;
    this.db = null;
    this.init();
  }

  init() {
    this.db = new sqlite3.Database(this.dbPath, (err) => {
      if (err) {
        console.error("Error opening database:", err);
      } else {
        console.log("Connected to SQLite database");
        this.createTable();
      }
    });
  }

  createTable() {
    const sql = `
        CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY,  -- removed AUTOINCREMENT for efficiency
            phone_number TEXT NOT NULL,
            amount REAL NOT NULL,
            details TEXT,
            date TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `;

    this.db.run(sql, (err) => {
      if (err) {
        console.error("Error creating table:", err);
      } else {
        // Create indexes for faster queries
        this.db.run(
          `CREATE INDEX IF NOT EXISTS idx_phone_number ON transactions(phone_number)`
        );
        this.db.run(
          `CREATE INDEX IF NOT EXISTS idx_date ON transactions(date)`
        );
        this.db.run(
          `CREATE INDEX IF NOT EXISTS idx_phone_date ON transactions(phone_number, date)`
        ); // useful for combined lookups
      }
    });
  }

  addTransaction(phoneNumber, amount, details = null) {
    return new Promise((resolve, reject) => {
      const sql = `INSERT INTO transactions (phone_number, amount, details, date) VALUES (?, ?, ?, ?)`;
      const date = new Date().toISOString();

      this.db.run(sql, [phoneNumber, amount, details, date], function (err) {
        if (err) {
          reject(err);
        } else {
          resolve({ id: this.lastID, phoneNumber, amount, details, date });
        }
      });
    });
  }

  getTotalSent(phoneNumber) {
    return new Promise((resolve, reject) => {
      const sql = `SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE phone_number = ?`;

      this.db.get(sql, [phoneNumber], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row.total);
        }
      });
    });
  }

  getLastTransaction(phoneNumber) {
    return new Promise((resolve, reject) => {
      const sql = `SELECT * FROM transactions WHERE phone_number = ? ORDER BY created_at DESC LIMIT 1`;

      this.db.get(sql, [phoneNumber], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row || null);
        }
      });
    });
  }

  getTransactionsByDate(phoneNumber, targetDate) {
    return new Promise((resolve, reject) => {
      const startOfDay = new Date(targetDate);
      startOfDay.setHours(0, 0, 0, 0);

      const endOfDay = new Date(targetDate);
      endOfDay.setHours(23, 59, 59, 999);

      const sql = `SELECT * FROM transactions 
                        WHERE phone_number = ? 
                        AND datetime(date) >= datetime(?) 
                        AND datetime(date) <= datetime(?)
                        ORDER BY created_at DESC`;

      this.db.all(
        sql,
        [phoneNumber, startOfDay.toISOString(), endOfDay.toISOString()],
        (err, rows) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows || []);
          }
        }
      );
    });
  }

  getTransactionsByPeriod(phoneNumber, amount, unit) {
    return new Promise((resolve, reject) => {
      const cutoffDate = new Date();

      switch (unit.toLowerCase()) {
        case "d":
          cutoffDate.setDate(cutoffDate.getDate() - (amount - 1));
          cutoffDate.setHours(0, 0, 0, 0);
          break;
        case "m":
          cutoffDate.setMonth(cutoffDate.getMonth() - amount);
          cutoffDate.setHours(0, 0, 0, 0);
          break;
        case "y":
          cutoffDate.setFullYear(cutoffDate.getFullYear() - amount);
          cutoffDate.setHours(0, 0, 0, 0);
          break;
        default:
          reject(new Error("Invalid unit"));
          return;
      }

      const sql = `SELECT * FROM transactions 
                        WHERE phone_number = ? 
                        AND datetime(date) >= datetime(?)
                        ORDER BY created_at DESC`;

      this.db.all(sql, [phoneNumber, cutoffDate.toISOString()], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows || []);
        }
      });
    });
  }

  getTransactionsByMonth(phoneNumber, month, year = null) {
    return new Promise((resolve, reject) => {
      const currentYear = new Date().getFullYear();
      const targetYear = year
        ? year.toString().length === 2
          ? 2000 + parseInt(year)
          : parseInt(year)
        : currentYear;

      const startDate = new Date(targetYear, month - 1, 1);
      const endDate = new Date(targetYear, month, 0, 23, 59, 59, 999);

      const sql = `SELECT * FROM transactions 
                        WHERE phone_number = ? 
                        AND datetime(date) >= datetime(?) 
                        AND datetime(date) <= datetime(?)
                        ORDER BY created_at DESC`;

      this.db.all(
        sql,
        [phoneNumber, startDate.toISOString(), endDate.toISOString()],
        (err, rows) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows || []);
          }
        }
      );
    });
  }

  close() {
    return new Promise((resolve, reject) => {
      if (this.db) {
        this.db.close((err) => {
          if (err) {
            reject(err);
          } else {
            console.log("Database connection closed");
            resolve();
          }
        });
      } else {
        resolve();
      }
    });
  }
}

module.exports = TransactionDao;
