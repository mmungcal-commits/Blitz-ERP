export async function first(db, sql, args = []) {
  return db.prepare(sql).bind(...args).first();
}

export async function all(db, sql, args = []) {
  const result = await db.prepare(sql).bind(...args).all();
  return result.results || [];
}

export async function run(db, sql, args = []) {
  return db.prepare(sql).bind(...args).run();
}

export async function batchChunks(db, statements, chunkSize = 50) {
  const results = [];
  for (let i = 0; i < statements.length; i += chunkSize) {
    const chunk = statements.slice(i, i + chunkSize);
    const response = await db.batch(chunk);
    results.push(...response);
  }
  return results;
}

export function placeholders(count) {
  return new Array(count).fill('?').join(',');
}

export async function ensureSchema(db) {
  const table = await first(db, "SELECT name FROM sqlite_master WHERE type='table' AND name='erp_settings'");
  if (!table) throw new Error('Connected ERP migration is not installed. Run migrations/0008_connected_erp.sql.');
}
