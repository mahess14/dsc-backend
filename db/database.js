// SQLite database stored in backend/database/ledger.db
// Uses sql.js (SQLite compiled to WebAssembly) so it installs on Windows
// without Visual Studio / Python build tools.
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const DB_FILE = path.join(__dirname, '..', 'database', 'ledger.db');
let db = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tokens (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,
  brand          TEXT DEFAULT '',
  category       TEXT NOT NULL DEFAULT 'USB Token',   -- USB Token | DSC Certificate | Other
  purchase_price REAL NOT NULL DEFAULT 0,             -- default buying price per unit
  sale_price     REAL NOT NULL DEFAULT 0,             -- default selling price per unit
  min_stock      INTEGER NOT NULL DEFAULT 5,          -- low-stock alert level
  active         INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stock_purchases (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  token_id      INTEGER NOT NULL REFERENCES tokens(id),
  supplier      TEXT DEFAULT '',
  quantity      INTEGER NOT NULL CHECK (quantity > 0),
  unit_cost     REAL NOT NULL CHECK (unit_cost >= 0),
  purchase_date TEXT NOT NULL,                        -- YYYY-MM-DD
  invoice_no    TEXT DEFAULT '',
  notes         TEXT DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sales (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  token_id        INTEGER NOT NULL REFERENCES tokens(id),
  customer_name   TEXT NOT NULL,
  customer_phone  TEXT DEFAULT '',
  customer_email  TEXT DEFAULT '',
  company         TEXT DEFAULT '',
  quantity        INTEGER NOT NULL CHECK (quantity > 0),
  unit_price      REAL NOT NULL CHECK (unit_price >= 0), -- selling price per unit
  unit_cost       REAL NOT NULL DEFAULT 0,               -- average buying cost per unit at time of sale
  sale_date       TEXT NOT NULL,                         -- YYYY-MM-DD
  payment_mode    TEXT DEFAULT 'Cash',                   -- Cash | UPI | Bank | Card | Credit
  payment_status  TEXT NOT NULL DEFAULT 'Paid',          -- Paid | Pending
  invoice_no      TEXT DEFAULT '',
  notes           TEXT DEFAULT '',
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(sale_date);
CREATE INDEX IF NOT EXISTS idx_sales_token ON sales(token_id);
CREATE INDEX IF NOT EXISTS idx_purchases_token ON stock_purchases(token_id);
`;

function persist() {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, Buffer.from(db.export()));
  fs.renameSync(tmp, DB_FILE);
}

async function init() {
  const SQL = await initSqlJs();
  db = fs.existsSync(DB_FILE) ? new SQL.Database(fs.readFileSync(DB_FILE)) : new SQL.Database();
  db.run('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  persist();
  return db;
}

/** All rows as plain objects. */
function all(sql, params = []) {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    return rows;
  } finally {
    stmt.free();
  }
}

/** First row or undefined. */
function get(sql, params = []) {
  return all(sql, params)[0];
}

/** INSERT / UPDATE / DELETE. Returns { id, changes }. Saves to disk unless inside a transaction. */
let inTx = false;
function run(sql, params = []) {
  db.run(sql, params);
  const id = get('SELECT last_insert_rowid() AS id').id;
  const changes = db.getRowsModified();
  if (!inTx) persist();
  return { id, changes };
}

/** Runs fn atomically: all writes succeed or none do. */
function transaction(fn) {
  db.run('BEGIN');
  inTx = true;
  try {
    const result = fn();
    db.run('COMMIT');
    inTx = false;
    persist();
    return result;
  } catch (e) {
    inTx = false;
    db.run('ROLLBACK');
    throw e;
  }
}

module.exports = { init, all, get, run, transaction, DB_FILE };
