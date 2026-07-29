-- Stations ↔ Lockers ↔ Batteries + connections. Run once.
CREATE TABLE IF NOT EXISTS lockers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  locker_no TEXT UNIQUE, station_code TEXT, slots INTEGER DEFAULT 8,
  status TEXT DEFAULT 'ACTIVE', created_at TEXT DEFAULT (datetime('now'))
);
ALTER TABLE battery_mapping ADD COLUMN locker_no TEXT;
