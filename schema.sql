-- E88 FinSys — Supply Chain core (Cloudflare D1 / SQLite)
-- Serial uniqueness is enforced at the database level (see inventory_serials.serial_no UNIQUE).

PRAGMA foreign_keys = ON;

-- ---------- Masters ----------
CREATE TABLE IF NOT EXISTS items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  sku          TEXT UNIQUE,
  description  TEXT NOT NULL,
  category     TEXT,            -- e.g. Motorcycle, Battery, Charger
  class        TEXT,
  unit_cost    REAL DEFAULT 0,
  active        INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS locations (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  name    TEXT NOT NULL UNIQUE,
  active  INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS customers (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  code    TEXT UNIQUE,
  name    TEXT NOT NULL,
  active  INTEGER DEFAULT 1
);

-- ---------- Procurement ----------
CREATE TABLE IF NOT EXISTS purchase_orders (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  po_no       TEXT NOT NULL UNIQUE,
  vendor      TEXT,
  order_date  TEXT,
  status      TEXT NOT NULL DEFAULT 'DRAFT',   -- DRAFT|APPROVED|PARTIAL|RECEIVED|VOID
  total       REAL DEFAULT 0,
  created_by  TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS po_lines (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  po_id         INTEGER NOT NULL REFERENCES purchase_orders(id),
  item_id       INTEGER REFERENCES items(id),
  description   TEXT,
  qty           INTEGER NOT NULL DEFAULT 0,
  unit_cost     REAL DEFAULT 0,
  received_qty  INTEGER NOT NULL DEFAULT 0
);

-- ---------- Receiving ----------
CREATE TABLE IF NOT EXISTS receipts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_no   TEXT NOT NULL UNIQUE,
  po_id        INTEGER REFERENCES purchase_orders(id),
  location_id  INTEGER REFERENCES locations(id),
  qty          INTEGER DEFAULT 0,
  received_by  TEXT,
  received_at  TEXT DEFAULT (datetime('now'))
);

-- ---------- Inventory (serial level) ----------
-- serial_no is UNIQUE: duplicates cannot be inserted. Migration de-dupes into this table.
CREATE TABLE IF NOT EXISTS inventory_serials (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  serial_no    TEXT NOT NULL UNIQUE,
  item_id      INTEGER REFERENCES items(id),
  item_desc    TEXT,
  category     TEXT,
  motor_no     TEXT,
  status       TEXT NOT NULL DEFAULT 'AVAILABLE', -- AVAILABLE|RESERVED|SOLD|LEASED|DEPLOYED|TRANSFERRED|DEMO|VOID
  location_id  INTEGER REFERENCES locations(id),
  location_name TEXT,
  customer_id  INTEGER REFERENCES customers(id),
  po_id        INTEGER REFERENCES purchase_orders(id),
  unit_cost    REAL DEFAULT 0,
  active       INTEGER DEFAULT 1,
  created_at   TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_serial_status ON inventory_serials(status);
CREATE INDEX IF NOT EXISTS idx_serial_item ON inventory_serials(item_id);

-- ---------- Sales ----------
CREATE TABLE IF NOT EXISTS sales (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  si_no       TEXT NOT NULL UNIQUE,
  customer_id INTEGER REFERENCES customers(id),
  sale_date   TEXT,
  status      TEXT NOT NULL DEFAULT 'DRAFT',   -- DRAFT|POSTED|VOID
  gross       REAL DEFAULT 0,
  created_by  TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sale_lines (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id    INTEGER NOT NULL REFERENCES sales(id),
  serial_no  TEXT REFERENCES inventory_serials(serial_no),
  item_desc  TEXT,
  price      REAL DEFAULT 0
);

-- ---------- Lease ----------
CREATE TABLE IF NOT EXISTS leases (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_no  TEXT NOT NULL UNIQUE,
  customer_id  INTEGER REFERENCES customers(id),
  serial_no    TEXT REFERENCES inventory_serials(serial_no),
  start_date   TEXT,
  monthly      REAL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'ACTIVE',  -- ACTIVE|CLOSED|VOID
  created_at   TEXT DEFAULT (datetime('now'))
);

-- ---------- Delivery ----------
CREATE TABLE IF NOT EXISTS deliveries (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  dr_no          TEXT NOT NULL UNIQUE,
  sale_id        INTEGER REFERENCES sales(id),
  serial_no      TEXT REFERENCES inventory_serials(serial_no),
  requested_date TEXT,
  delivery_date  TEXT,
  destination    TEXT,
  status         TEXT NOT NULL DEFAULT 'FOR_DELIVERY', -- FOR_DELIVERY|RELEASED|RECEIVED
  released_by    TEXT,
  received_by    TEXT,
  created_at     TEXT DEFAULT (datetime('now'))
);

-- ---------- Collections / AR ----------
CREATE TABLE IF NOT EXISTS customer_receivables (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id   INTEGER REFERENCES customers(id),
  sale_id       INTEGER REFERENCES sales(id),
  amount        REAL DEFAULT 0,
  balance       REAL DEFAULT 0,
  due_date      TEXT,
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS collections (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  or_no        TEXT NOT NULL UNIQUE,
  customer_id  INTEGER REFERENCES customers(id),
  sale_id      INTEGER REFERENCES sales(id),
  amount       REAL DEFAULT 0,
  collect_date TEXT,
  status       TEXT NOT NULL DEFAULT 'DRAFT',   -- DRAFT|POSTED
  created_by   TEXT,
  created_at   TEXT DEFAULT (datetime('now'))
);

-- ---------- Migration audit: duplicate serials found during import ----------
CREATE TABLE IF NOT EXISTS serial_dupe_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  serial_no   TEXT,
  occurrences INTEGER,
  kept_source TEXT,
  note        TEXT,
  logged_at   TEXT DEFAULT (datetime('now'))
);
