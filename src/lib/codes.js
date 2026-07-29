import { first, run } from './db.js';

export function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeKey(value) {
  return normalizeText(value).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
}

export function normalizeSerial(value) {
  return normalizeText(value).toUpperCase().replace(/\s+/g, '').replace(/[–—]/g, '-');
}

export function categoryCode(category) {
  const key = normalizeKey(category);
  if (key.includes('MOTOR') || key === 'MC') return 'MC';
  // Check station/locker identity before BAT so "battery swapping station" is BSS, not a battery item.
  if (key.includes('LOCKER') || key.includes('STATION') || key.includes('BSS') || key.includes('SPACEPORT')) return 'BSS';
  if (key.includes('BAT')) return 'BAT';
  if (key.includes('SPARE') || key.includes('PART')) return 'SP';
  if (key.includes('CHARG')) return 'CHG';
  return 'OTH';
}

export async function nextCode(db, sequenceCode, fallbackPrefix = sequenceCode, width = 6) {
  let row = await first(db,
    `UPDATE erp_sequences SET next_value=next_value+1, updated_at=datetime('now')
     WHERE code=? RETURNING next_value-1 AS n, prefix, width`, [sequenceCode]);
  if (!row) {
    await run(db, `INSERT INTO erp_sequences(code,next_value,prefix,width) VALUES(?,2,?,?)`, [sequenceCode, fallbackPrefix, width]);
    row = { n: 1, prefix: fallbackPrefix, width };
  }
  return `${row.prefix}-${String(row.n).padStart(row.width || width, '0')}`;
}

export async function ensureLocation(db, name, type = 'OTHER', code = '') {
  const cleanName = normalizeText(name || 'Unassigned');
  let row = await first(db, `SELECT * FROM erp_locations WHERE upper(name)=upper(?) OR code=? LIMIT 1`, [cleanName, code || '__NONE__']);
  if (row) return row;
  const locationCode = code || await nextCode(db, 'LOCATION', 'LOC', 5);
  const result = await run(db,
    `INSERT INTO erp_locations(code,name,location_type) VALUES(?,?,?)`,
    [locationCode, cleanName, type]);
  return { id: result.meta.last_row_id, code: locationCode, name: cleanName, location_type: type };
}

export async function ensurePartner(db, { name, type = 'CUSTOMER', code = '', address = '', email = '', phone = '', sourceSystem = '', sourceKey = '' }) {
  const cleanName = normalizeText(name || 'Unknown');
  let row = await first(db,
    `SELECT * FROM erp_partners WHERE partner_type=? AND upper(name)=upper(?) LIMIT 1`, [type, cleanName]);
  if (row) return row;
  const prefix = type === 'VENDOR' ? 'VEN' : type === 'EMPLOYEE' ? 'EMP' : type === 'SITE_PARTNER' ? 'PAR' : 'CUS';
  const partnerCode = code || await nextCode(db, `PARTNER_${type}`, prefix, 6);
  const result = await run(db,
    `INSERT INTO erp_partners(partner_code,partner_type,name,address,email,phone,source_system,source_key)
     VALUES(?,?,?,?,?,?,?,?)`,
    [partnerCode, type, cleanName, normalizeText(address), normalizeText(email).toLowerCase(), normalizeText(phone), sourceSystem, sourceKey]);
  return { id: result.meta.last_row_id, partner_code: partnerCode, partner_type: type, name: cleanName };
}

export async function ensureItem(db, item) {
  const category = categoryCode(item.category || item.itemName || item.description);
  const name = normalizeText(item.itemName || item.description || `${category} Item`);
  const normalized = normalizeKey(name);
  let row = await first(db,
    `SELECT * FROM erp_items WHERE normalized_name=? AND category=? LIMIT 1`, [normalized, category]);
  if (row) return row;

  if (item.itemCode) {
    row = await first(db, `SELECT * FROM erp_items WHERE item_code=? LIMIT 1`, [normalizeText(item.itemCode)]);
    if (row) return row;
  }

  const itemCode = item.itemCode || await nextCode(db, `ITEM_${category}`, category, 6);
  const result = await run(db,
    `INSERT INTO erp_items(item_code,item_name,normalized_name,category,subcategory,manufacturer,model,color,serialized,standard_cost,auto_created,source_system,source_key)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [itemCode, name, normalized, category, normalizeText(item.subcategory), normalizeText(item.manufacturer),
     normalizeText(item.model), normalizeText(item.color), item.serialized ? 1 : 0, Number(item.standardCost || 0),
     item.autoCreated === false ? 0 : 1, normalizeText(item.sourceSystem), normalizeText(item.sourceKey)]);
  return { id: result.meta.last_row_id, item_code: itemCode, item_name: name, category, serialized: item.serialized ? 1 : 0 };
}
