import { normalizeText } from './codes.js';

const PURPOSE_ALIASES = new Map([
  ['SALES','SALE'],['SALE TO CLIENT','SALE'],['CUSTOMER SALE','SALE'],
  ['LEASE TO CLIENT','LEASE'],['LEASE DEPLOYMENT','LEASE'],['RENTAL','LEASE'],
  ['TEST','DEMO'],['TEST/DEMO','DEMO'],['TEST AND DEMO','DEMO'],['DEMO UNIT','DEMO'],
  ['PILOT TEST','PILOT'],['PILOT-TEST','PILOT'],
  ['ASSIGNMENT','EMPLOYEE_USE'],['EMPLOYEE ASSIGNMENT','EMPLOYEE_USE'],['EMPLOYEE UNIT','EMPLOYEE_USE'],
  ['INTERNAL','INTERNAL_USE'],['DEPARTMENT USE','INTERNAL_USE'],['OFFICE USE','INTERNAL_USE'],
  ['PROJECT','PROJECT_DEPLOYMENT'],['BSS DEPLOYMENT','PROJECT_DEPLOYMENT'],['STATION DEPLOYMENT','PROJECT_DEPLOYMENT'],
  ['DEALER','DEALER_RETAIL'],['CONSIGNMENT','DEALER_RETAIL'],
  ['REPLACEMENT PARTS','REPLACEMENT'],['WARRANTY REPLACEMENT','REPLACEMENT'],['PARTS REPLACEMENT','REPLACEMENT'],
  ['STOCK TRANSFER','INVENTORY_TRANSFER'],['TRANSFER','INVENTORY_TRANSFER'],['INVENTORY TRANSFER','INVENTORY_TRANSFER'],
  ['DISPOSAL','WRITE_OFF'],['SCRAP','WRITE_OFF'],['LOST','WRITE_OFF'],
]);

export function normalizeTransactionPurpose(value = '') {
  const raw = normalizeText(value).replaceAll('_',' ').replace(/\s+/g,' ').trim().toUpperCase();
  if (!raw) return 'INTERNAL_USE';
  if (PURPOSE_ALIASES.has(raw)) return PURPOSE_ALIASES.get(raw);
  const canonical = raw.replaceAll(' ','_');
  if (['SALE','LEASE','DEMO','PILOT','EMPLOYEE_USE','INTERNAL_USE','PROJECT_DEPLOYMENT',
    'DEALER_RETAIL','REPLACEMENT','INVENTORY_TRANSFER','WRITE_OFF','DONATION'].includes(canonical)) return canonical;
  if (raw.includes('SALE')) return 'SALE';
  if (raw.includes('LEASE') || raw.includes('RENT')) return 'LEASE';
  if (raw.includes('PILOT')) return 'PILOT';
  if (raw.includes('DEMO') || raw.includes('TEST')) return 'DEMO';
  if (raw.includes('EMPLOYEE') || raw.includes('ASSIGN')) return 'EMPLOYEE_USE';
  if (raw.includes('PROJECT') || raw.includes('BSS') || raw.includes('STATION')) return 'PROJECT_DEPLOYMENT';
  if (raw.includes('DEALER') || raw.includes('CONSIGN')) return 'DEALER_RETAIL';
  if (raw.includes('REPLACE') || raw.includes('WARRANTY')) return 'REPLACEMENT';
  if (raw.includes('TRANSFER')) return 'INVENTORY_TRANSFER';
  if (raw.includes('WRITE') || raw.includes('SCRAP') || raw.includes('LOST')) return 'WRITE_OFF';
  if (raw.includes('DONAT')) return 'DONATION';
  return canonical;
}

export function isDurableCategory(category = '') {
  return ['MC','BAT','BSS','CHG'].includes(normalizeText(category).toUpperCase());
}

export function normalizeInventoryCategory(category = '') {
  const raw = normalizeText(category).replaceAll('_',' ').replace(/\s+/g,' ').trim().toUpperCase();
  if (['MC','MOTORCYCLE','MOTORCYCLES','MOTORBIKE','MOTORBIKES'].includes(raw)) return 'MC';
  if (['BAT','BATTERY','BATTERIES','BATTERY PACK','BATTERY PACKS'].includes(raw)) return 'BAT';
  if (['BSS','LOCKER','LOCKERS','BATTERY STATION','BATTERY STATIONS','BATTERY SWAPPING STATION','RIDEBOX'].includes(raw)) return 'BSS';
  if (['SP','SPARE PART','SPARE PARTS','SPAREPART','SPAREPARTS','PART','PARTS'].includes(raw)) return 'SP';
  if (['CHG','CHARGER','CHARGERS','CHARGING EQUIPMENT','FAST CHARGER'].includes(raw)) return 'CHG';
  return raw || 'OTH';
}

export function inventoryClassLabel(category = '') {
  const code = normalizeInventoryCategory(category);
  return {MC:'Motorcycles',BAT:'Batteries',BSS:'Lockers / BSS',SP:'Spare Parts',CHG:'Chargers',OTH:'Other Inventory'}[code] || code;
}

export function inventoryAccountForCategory(category = '') {
  const code = normalizeInventoryCategory(category);
  return {MC:'1200',BAT:'1220',BSS:'1225',SP:'1235',CHG:'1245',OTH:'1248'}[code] || '1248';
}

export function cogsAccountForCategory(category = '') {
  const code = normalizeInventoryCategory(category);
  return {MC:'5000',BAT:'5020',BSS:'5030',SP:'5040',CHG:'5050',OTH:'5090'}[code] || '5090';
}

export function fixedAssetAccountsForCategory(category = '') {
  const code = normalizeInventoryCategory(category);
  return {
    assetClass: code === 'BSS' ? 'BSS_AND_RIDEBOX_EQUIPMENT'
      : code === 'BAT' ? 'LEASE_BATTERY_POOL'
        : code === 'CHG' ? 'CHARGING_EQUIPMENT' : 'MOTORCYCLES_HELD_FOR_LEASE',
    assetAccountCode: code === 'BSS' ? '1320' : code === 'BAT' ? '1330' : code === 'CHG' ? '1340' : '1310',
    accumulatedDepreciationAccountCode: '1390',
    depreciationExpenseAccountCode: '6800',
    usefulLifeMonths: code === 'BSS' ? 60 : 36,
  };
}

export function classifyInventoryTreatment({ purpose, category, serialized = true, override = '' } = {}) {
  const normalizedPurpose = normalizeTransactionPurpose(override || purpose);
  const cat = normalizeInventoryCategory(category);
  const durable = isDurableCategory(cat) && serialized !== false;
  const base = {
    purpose: normalizedPurpose,
    category: cat,
    durable,
    ownership: 'COMPANY',
    holderType: 'INTERNAL',
    targetStatus: 'DEPLOYED',
    inventoryEffect: 'CUSTODY',
    financeEventType: null,
    financialEffect: 'NONE',
    returnRequired: false,
    expenseAccountCode: '6990',
    businessLine: 'INTERNAL',
  };
  if (normalizedPurpose === 'SALE') return {
    ...base, ownership:'CUSTOMER',holderType:'CUSTOMER',targetStatus:'SOLD',inventoryEffect:'ISSUE',
    financeEventType:'SALE_COGS',financialEffect:'ACCOUNTING',businessLine:'SALE',
  };
  if (normalizedPurpose === 'LEASE') return {
    ...base,holderType:'CUSTOMER',targetStatus:'LEASED',inventoryEffect:durable?'CAPITALIZE':'CONSUME',
    financeEventType:durable?'CAPITALIZATION':'INVENTORY_CONSUMPTION',
    financialEffect:'ACCOUNTING',returnRequired:durable,businessLine:'LEASE',expenseAccountCode:'5010',
  };
  if (normalizedPurpose === 'DEMO') return {
    ...base,holderType:'CUSTOMER',targetStatus:'DEMO',returnRequired:true,businessLine:'DEMO',
  };
  if (normalizedPurpose === 'PILOT') return {
    ...base,holderType:'CUSTOMER',targetStatus:'PILOT_TEST',returnRequired:true,businessLine:'PILOT',
  };
  if (normalizedPurpose === 'EMPLOYEE_USE') return {
    ...base,holderType:'EMPLOYEE',targetStatus:'EMPLOYEE_ASSIGNED',inventoryEffect:durable?'CAPITALIZE':'CONSUME',
    financeEventType:durable?'CAPITALIZATION':'INVENTORY_CONSUMPTION',financialEffect:'ACCOUNTING',
    returnRequired:durable,businessLine:'INTERNAL',expenseAccountCode:'6500',
  };
  if (normalizedPurpose === 'INTERNAL_USE') return {
    ...base,holderType:'DEPARTMENT',targetStatus:'INTERNAL_ASSIGNED',inventoryEffect:durable?'CAPITALIZE':'CONSUME',
    financeEventType:durable?'CAPITALIZATION':'INVENTORY_CONSUMPTION',financialEffect:'ACCOUNTING',
    returnRequired:durable,businessLine:'INTERNAL',expenseAccountCode:'6500',
  };
  if (normalizedPurpose === 'PROJECT_DEPLOYMENT') return {
    ...base,holderType:'PROJECT_SITE',targetStatus:'PROJECT_ASSIGNED',inventoryEffect:durable?'CAPITALIZE':'CONSUME',
    financeEventType:durable?'CAPITALIZATION':'INVENTORY_CONSUMPTION',financialEffect:'ACCOUNTING',
    returnRequired:durable,businessLine:cat === 'BSS' || cat === 'BAT' ? 'ENERGY' : 'PROJECT',expenseAccountCode:'6500',
  };
  if (normalizedPurpose === 'DEALER_RETAIL') return {
    ...base,holderType:'DEALER',targetStatus:'CONSIGNED',returnRequired:true,businessLine:'DEALER_RETAIL',
  };
  if (normalizedPurpose === 'REPLACEMENT') return {
    ...base,holderType:'CUSTOMER',targetStatus:'REPLACEMENT_ISSUED',inventoryEffect:'ISSUE',
    financeEventType:'WARRANTY_ISSUE',financialEffect:'ACCOUNTING',returnRequired:true,
    businessLine:'AFTERSALES',expenseAccountCode:'6500',
  };
  if (normalizedPurpose === 'INVENTORY_TRANSFER') return {
    ...base,holderType:'WAREHOUSE',targetStatus:'AVAILABLE',inventoryEffect:'TRANSFER',businessLine:'INVENTORY',
  };
  if (normalizedPurpose === 'WRITE_OFF') return {
    ...base,targetStatus:'WRITTEN_OFF',inventoryEffect:'ISSUE',financeEventType:'INVENTORY_WRITE_OFF',
    financialEffect:'ACCOUNTING',businessLine:'INVENTORY',expenseAccountCode:'6900',
  };
  if (normalizedPurpose === 'DONATION') return {
    ...base,holderType:'EXTERNAL_PARTY',targetStatus:'DONATED',inventoryEffect:'ISSUE',
    financeEventType:'DONATION_ISSUE',financialEffect:'ACCOUNTING',businessLine:'COMMUNITY',expenseAccountCode:'6990',
  };
  return base;
}

export function treatmentRequiresValuation(treatment) {
  return treatment?.financialEffect === 'ACCOUNTING' && [
    'SALE_COGS','CAPITALIZATION','INVENTORY_CONSUMPTION','WARRANTY_ISSUE','INVENTORY_WRITE_OFF','DONATION_ISSUE',
  ].includes(treatment.financeEventType);
}
