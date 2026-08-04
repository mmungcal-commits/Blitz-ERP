-- Assembly / BOM: build from parts with rolled-up cost, disassemble back
CREATE TABLE IF NOT EXISTS erp_assemblies(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assembly_no TEXT,
  output_item_name TEXT,
  location_id INTEGER,
  location_code TEXT,
  status TEXT NOT NULL DEFAULT 'BUILT',
  total_cost REAL DEFAULT 0,
  component_count INTEGER DEFAULT 0,
  notes TEXT,
  built_by TEXT,
  built_at TEXT DEFAULT (datetime('now')),
  disassembled_at TEXT
);
CREATE TABLE IF NOT EXISTS erp_assembly_components(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assembly_id INTEGER NOT NULL,
  item_id INTEGER,
  item_code TEXT,
  item_name TEXT,
  serial_no TEXT,
  qty REAL DEFAULT 1,
  unit_cost REAL DEFAULT 0,
  line_cost REAL DEFAULT 0,
  asset_id INTEGER,
  prior_status TEXT
);
CREATE INDEX IF NOT EXISTS ix_asm_status ON erp_assemblies(status);
CREATE INDEX IF NOT EXISTS ix_asmc_asm ON erp_assembly_components(assembly_id);
