import * as XLSX from 'xlsx';
import { normalizeSerial, normalizeText, normalizeKey, categoryCode } from './codes.js';

const HEADER_ALIASES = {
  batch: ['BATCH'],
  manufacturer: ['MANUFACTURER','BRAND'],
  model: ['MODEL','PRODUCT'],
  color: ['COLOR','COLOR 颜色'],
  frame: ['FRAME NO','FRAME NO. 车架号 / VIN / CHASSIS','VIN','CHASSIS','CHASSIS NO'],
  motor: ['MOTOR NO','MOTOR NO. 电机号 / ENGINE','ENGINE','ENGINE NO'],
  barcode: ['BAR CODE / BATTERY DEVID','BAR CODE','BATTERY DEVID','BATTERY SERIAL','SERIAL'],
  imei: ['IMEI / IMSI','IMEI  / IMSI','IMEI','IMSI'],
  lockerSerial: ['SN NO.','SN NO','SERIAL NO','LOCKER SERIAL'],
  location: ['LOCATION','SITE'],
  onboardingDate: ['ONBOARDING DATE','ONBOARDING','ONBOARDING '],
  invoiceCode: ['INVOICE CODE'],
  plate: ['PLATE NUMBER'],
  csr: ['CSR NUMBER'],
};

function canonicalHeader(value) {
  return normalizeKey(value).replace(/\s+/g, ' ');
}

function findHeaderIndex(headers, aliases) {
  const canon = headers.map(canonicalHeader);
  for (const alias of aliases) {
    const a = canonicalHeader(alias);
    const i = canon.findIndex(h => h === a || h.includes(a) || a.includes(h));
    if (i >= 0) return i;
  }
  return -1;
}

function field(row, headers, aliasKey) {
  const i = findHeaderIndex(headers, HEADER_ALIASES[aliasKey] || []);
  return i >= 0 ? row[i] : '';
}

function dateValue(value) {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0,10);
  const s = normalizeText(value);
  return s;
}

function sheetRows(workbook, sheetName) {
  const ws = workbook.Sheets[sheetName];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false, blankrows: false });
}

function findHeaderRow(rows, expectedWords) {
  for (let i = 0; i < Math.min(rows.length, 20); i += 1) {
    const joined = rows[i].map(canonicalHeader).join(' | ');
    if (expectedWords.some(w => joined.includes(canonicalHeader(w)))) return i;
  }
  return 0;
}

function parseMotorcycles(workbook) {
  const rows = sheetRows(workbook, 'MOTORCYCLE');
  if (!rows.length) return [];
  const hi = findHeaderRow(rows, ['FRAME NO','VIN','CHASSIS']);
  const headers = rows[hi];
  return rows.slice(hi + 1).map((row, idx) => {
    const serial = normalizeSerial(field(row, headers, 'frame'));
    if (!serial) return null;
    const model = normalizeText(field(row, headers, 'model'));
    const color = normalizeText(field(row, headers, 'color'));
    return {
      recordType: 'ASSET', serialType: 'MOTORCYCLE', category: 'MC', serialNo: serial,
      secondarySerial: normalizeSerial(field(row, headers, 'motor')),
      batchCode: normalizeText(field(row, headers, 'batch')),
      manufacturer: normalizeText(field(row, headers, 'manufacturer')),
      model, color,
      itemName: [model, color].filter(Boolean).join(' '),
      location: normalizeText(field(row, headers, 'location')),
      onboardingDate: dateValue(field(row, headers, 'onboardingDate')),
      invoiceCode: normalizeText(field(row, headers, 'invoiceCode')),
      plateNo: normalizeText(field(row, headers, 'plate')),
      csrNo: normalizeText(field(row, headers, 'csr')),
      sourceSheet: 'MOTORCYCLE', sourceRow: hi + idx + 2,
    };
  }).filter(Boolean);
}

function parseBatteries(workbook) {
  const rows = sheetRows(workbook, 'BATTERY');
  if (!rows.length) return [];
  const hi = findHeaderRow(rows, ['BAR CODE','BATTERY DEVID']);
  const headers = rows[hi];
  return rows.slice(hi + 1).map((row, idx) => {
    const serial = normalizeSerial(field(row, headers, 'barcode'));
    if (!serial) return null;
    const model = normalizeText(field(row, headers, 'model'));
    return {
      recordType: 'ASSET', serialType: 'BATTERY', category: 'BAT', serialNo: serial,
      secondarySerial: normalizeSerial(field(row, headers, 'imei')),
      batchCode: normalizeText(field(row, headers, 'batch')),
      manufacturer: normalizeText(field(row, headers, 'manufacturer')),
      model, color: '', itemName: `Battery ${model}`.trim(),
      location: normalizeText(field(row, headers, 'location')),
      onboardingDate: dateValue(field(row, headers, 'onboardingDate')),
      sourceSheet: 'BATTERY', sourceRow: hi + idx + 2,
    };
  }).filter(Boolean);
}

function parseLockers(workbook) {
  const rows = sheetRows(workbook, 'LOCKER');
  if (!rows.length) return [];
  const hi = findHeaderRow(rows, ['SN NO','SERIAL NO']);
  const headers = rows[hi];
  return rows.slice(hi + 1).map((row, idx) => {
    const serial = normalizeSerial(field(row, headers, 'lockerSerial'));
    if (!serial) return null;
    const model = normalizeText(field(row, headers, 'model'));
    const color = normalizeText(field(row, headers, 'color'));
    return {
      recordType: 'ASSET', serialType: 'SWAPPING_STATION', category: 'BSS', serialNo: serial,
      secondarySerial: normalizeSerial(field(row, headers, 'imei')),
      batchCode: normalizeText(field(row, headers, 'batch')),
      manufacturer: normalizeText(field(row, headers, 'manufacturer')),
      model, color, itemName: `Swapping Station ${model}`.trim(),
      location: normalizeText(field(row, headers, 'location')),
      onboardingDate: dateValue(field(row, headers, 'onboardingDate')),
      sourceSheet: 'LOCKER', sourceRow: hi + idx + 2,
    };
  }).filter(Boolean);
}

export async function parseAtlasFile(arrayBuffer) {
  const workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: true, cellNF: false });
  const rows = [...parseMotorcycles(workbook), ...parseBatteries(workbook), ...parseLockers(workbook)];
  const seen = new Map();
  const normalized = rows.map(record => {
    const key = record.serialNo;
    if (seen.has(key)) {
      return { ...record, validationStatus: 'EXCEPTION', validationMessage: `Duplicate serial in uploaded ATLAS; first seen at ${seen.get(key)}` };
    }
    seen.set(key, `${record.sourceSheet} row ${record.sourceRow}`);
    if (!record.batchCode) return { ...record, validationStatus: 'EXCEPTION', validationMessage: 'Batch code is missing' };
    return { ...record, validationStatus: 'VALID', validationMessage: '' };
  });
  return {
    rows: normalized,
    sheets: workbook.SheetNames,
    summary: {
      total: normalized.length,
      valid: normalized.filter(x => x.validationStatus === 'VALID').length,
      exceptions: normalized.filter(x => x.validationStatus !== 'VALID').length,
      motorcycles: normalized.filter(x => x.category === 'MC').length,
      batteries: normalized.filter(x => x.category === 'BAT').length,
      stations: normalized.filter(x => x.category === 'BSS').length,
      batches: [...new Set(normalized.map(x => x.batchCode).filter(Boolean))].length,
    },
  };
}

export function groupAtlasRows(rows) {
  const batches = new Map();
  for (const row of rows.filter(x => x.validationStatus === 'VALID')) {
    const key = row.batchCode;
    if (!batches.has(key)) batches.set(key, { batchCode: key, supplierName: row.manufacturer || 'Supplier', rows: [] });
    batches.get(key).rows.push(row);
  }
  return [...batches.values()];
}

export function itemIdentity(row) {
  return {
    itemName: row.itemName || `${row.serialType} ${row.model || ''}`.trim(),
    category: categoryCode(row.category),
    manufacturer: row.manufacturer,
    model: row.model,
    color: row.color,
    serialized: true,
    autoCreated: true,
    sourceSystem: 'ATLAS',
    sourceKey: `${row.category}|${row.manufacturer}|${row.model}|${row.color}`,
  };
}
