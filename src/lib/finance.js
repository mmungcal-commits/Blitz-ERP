import { all, first, run } from './db.js';
import { nextCode, normalizeText } from './codes.js';
import { cogsAccountForCategory, inventoryAccountForCategory } from './transaction-rules.js';

const round = value => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

export async function entityByCode(db, entityCode = 'E88') {
  return first(db, `SELECT * FROM erp_legal_entities WHERE entity_code=? AND active=1`, [
    normalizeText(entityCode || 'E88').toUpperCase(),
  ]);
}

export async function accountByCode(db, accountCode) {
  return first(db, `SELECT * FROM erp_chart_accounts WHERE account_code=? AND active=1`, [
    normalizeText(accountCode),
  ]);
}

export async function ensureAccountingPeriod(db, entityId, journalDate) {
  const date = (normalizeText(journalDate) || new Date().toISOString()).slice(0, 10);
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  if (!year || month < 1 || month > 12) throw new Error('A valid journal date is required.');
  let period = await first(db,
    `SELECT * FROM erp_accounting_periods
      WHERE entity_id=? AND fiscal_year=? AND period_no=?`,
    [entityId, year, month]);
  if (!period) {
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const next = new Date(Date.UTC(year, month, 1));
    next.setUTCDate(0);
    const endDate = next.toISOString().slice(0, 10);
    await run(db,
      `INSERT INTO erp_accounting_periods(
        entity_id,fiscal_year,period_no,period_name,start_date,end_date,status
      ) VALUES(?,?,?,?,?,?,'OPEN')`,
      [entityId, year, month, `${year}-${String(month).padStart(2, '0')}`, startDate, endDate]);
    period = await first(db,
      `SELECT * FROM erp_accounting_periods
        WHERE entity_id=? AND fiscal_year=? AND period_no=?`,
      [entityId, year, month]);
  }
  return period;
}

function amountForBasis(basis, payload) {
  const gross = round(payload.grossAmount ?? payload.amount);
  const tax = round(payload.taxAmount);
  const withholding = round(payload.withholdingAmount);
  const net = round(payload.netAmount ?? (gross - tax));
  const cost = round(payload.costAmount ?? payload.amount);
  if (basis === 'GROSS') return gross;
  if (basis === 'NET') return net;
  if (basis === 'TAX') return tax;
  if (basis === 'WITHHOLDING') return withholding;
  if (basis === 'GROSS_LESS_WITHHOLDING') return round(gross - withholding);
  if (basis === 'COST') return cost;
  return round(payload.amount);
}

export function eventLines(eventType, payload = {}) {
  const gross = round(payload.grossAmount ?? payload.amount);
  const tax = round(payload.taxAmount);
  const withholding = round(payload.withholdingAmount);
  const net = round(payload.netAmount ?? (gross - tax));
  const cost = round(payload.costAmount ?? payload.amount);
  const inventoryAccount = payload.inventoryAccountCode || inventoryAccountForCategory(payload.category);
  const revenueAccount = payload.revenueAccountCode || (
    payload.businessLine === 'LEASE' ? '4010'
      : payload.businessLine === 'ENERGY' ? '4020'
        : payload.businessLine === 'AFTERSALES' ? '4030' : '4000'
  );
  const expenseAccount = payload.expenseAccountCode || '6990';
  const lines = [];
  const add = (accountCode, debit, credit, role, extra = {}) => {
    const d = round(debit);
    const c = round(credit);
    if (!d && !c) return;
    lines.push({ accountCode, debit:d, credit:c, lineRole:role, ...extra });
  };
  if (eventType === 'GOODS_RECEIPT') {
    add(inventoryAccount, net || gross || cost, 0, 'INVENTORY');
    add('2050', 0, net || gross || cost, 'GRNI');
  } else if (eventType === 'LANDED_COST') {
    const capitalizable = round(payload.capitalizableAmount ?? net ?? cost);
    add(inventoryAccount, capitalizable, 0, 'INVENTORY');
    add(payload.accrualAccountCode || '2060', 0, capitalizable, 'LANDED_COST_ACCRUAL');
  } else if (eventType === 'SUPPLIER_BILL') {
    add(payload.debitAccountCode || expenseAccount, net, 0, 'EXPENSE_OR_INVENTORY');
    add('1150', tax, 0, 'INPUT_VAT');
    add('2000', 0, round(gross - withholding), 'PAYABLE');
    add('2110', 0, withholding, 'WITHHOLDING');
  } else if (eventType === 'CUSTOMER_INVOICE' || eventType === 'LEASE_BILLING') {
    add('1100', gross, 0, 'RECEIVABLE');
    add(revenueAccount, 0, net, 'REVENUE');
    add('2100', 0, tax, 'OUTPUT_VAT');
  } else if (eventType === 'CUSTOMER_RECEIPT') {
    add(payload.bankAccountCode || '1010', gross, 0, 'BANK');
    add('1100', 0, gross, 'RECEIVABLE');
  } else if (eventType === 'SUPPLIER_PAYMENT') {
    add('2000', gross, 0, 'PAYABLE');
    add(payload.bankAccountCode || '1010', 0, gross, 'BANK');
  } else if (eventType === 'SALE_COGS') {
    add(payload.cogsAccountCode || cogsAccountForCategory(payload.category), cost, 0, 'COGS');
    add(inventoryAccount, 0, cost, 'INVENTORY');
  } else if (eventType === 'SALES_RETURN_INVENTORY') {
    add(inventoryAccount, cost, 0, 'INVENTORY_RETURN');
    add(payload.cogsAccountCode || cogsAccountForCategory(payload.category), 0, cost, 'COGS_REVERSAL');
  } else if (eventType === 'CAPITALIZATION') {
    add(payload.assetAccountCode || '1310', cost, 0, 'FIXED_ASSET');
    add(inventoryAccount, 0, cost, 'INVENTORY');
  } else if (eventType === 'INVENTORY_CONSUMPTION') {
    add(payload.expenseAccountCode || expenseAccount, cost, 0, 'CONSUMPTION_EXPENSE');
    add(inventoryAccount, 0, cost, 'INVENTORY');
  } else if (eventType === 'WARRANTY_ISSUE') {
    add(payload.expenseAccountCode || '6500', cost, 0, 'WARRANTY_EXPENSE');
    add(inventoryAccount, 0, cost, 'INVENTORY');
  } else if (eventType === 'DONATION_ISSUE') {
    add(payload.expenseAccountCode || '6990', cost, 0, 'DONATION_EXPENSE');
    add(inventoryAccount, 0, cost, 'INVENTORY');
  } else if (eventType === 'CUSTOMER_CREDIT') {
    add(revenueAccount, net, 0, 'REVENUE_REVERSAL');
    add('2100', tax, 0, 'OUTPUT_VAT_REVERSAL');
    add('1100', 0, gross, 'RECEIVABLE');
  } else if (eventType === 'LEASE_DEPOSIT') {
    add(payload.bankAccountCode || '1010', gross, 0, 'BANK');
    add(payload.depositAccountCode || '2250', 0, gross, 'CUSTOMER_DEPOSIT');
  } else if (eventType === 'ASSET_RETIREMENT') {
    const originalCost = round(payload.originalCost ?? cost);
    const accumulated = round(payload.accumulatedDepreciation);
    const netBookValue = round(payload.netBookValue ?? Math.max(0, originalCost - accumulated));
    add(payload.accumulatedDepreciationAccountCode || '1390', accumulated, 0, 'ACCUMULATED_DEPRECIATION_CLEARING');
    add(payload.lossAccountCode || '6900', netBookValue, 0, 'RETIREMENT_LOSS');
    add(payload.assetAccountCode || '1310', 0, originalCost, 'FIXED_ASSET');
  } else if (eventType === 'INVENTORY_VALUATION_ADJUSTMENT') {
    const direction = normalizeText(payload.adjustmentDirection || 'INCREASE').toUpperCase();
    if (direction === 'INCREASE') {
      add(inventoryAccount, cost, 0, 'INVENTORY');
      add(payload.offsetAccountCode || '6900', 0, cost, 'VALUATION_VARIANCE');
    } else {
      add(payload.offsetAccountCode || '6900', cost, 0, 'VALUATION_VARIANCE');
      add(inventoryAccount, 0, cost, 'INVENTORY');
    }
  } else if (eventType === 'INVENTORY_WRITE_OFF' || eventType === 'CYCLE_COUNT_ADJUSTMENT') {
    const direction = normalizeText(payload.adjustmentDirection || 'DECREASE').toUpperCase();
    if (direction === 'INCREASE') {
      add(inventoryAccount, cost, 0, 'INVENTORY');
      add('6900', 0, cost, 'VARIANCE');
    } else {
      add('6900', cost, 0, 'VARIANCE');
      add(inventoryAccount, 0, cost, 'INVENTORY');
    }
  } else if (eventType === 'DEPRECIATION') {
    add(payload.depreciationExpenseAccountCode || '6800', gross, 0, 'DEPRECIATION_EXPENSE');
    add(payload.accumulatedDepreciationAccountCode || '1390', 0, gross, 'ACCUMULATED_DEPRECIATION');
  } else if (eventType === 'PROJECT_BILLING' || eventType === 'REVENUE_RECOGNITION') {
    add(payload.receivableAccountCode || (eventType === 'REVENUE_RECOGNITION' ? '1110' : '1100'), gross, 0, eventType === 'REVENUE_RECOGNITION' ? 'CONTRACT_ASSET' : 'RECEIVABLE');
    add(payload.revenueAccountCode || '4040', 0, net || gross, 'PROJECT_REVENUE');
    add('2100', 0, tax, 'OUTPUT_VAT');
  } else if (eventType === 'EXPENSE_REIMBURSEMENT') {
    add(payload.expenseAccountCode || '6520', net || gross, 0, 'REIMBURSABLE_EXPENSE');
    add('1150', tax, 0, 'INPUT_VAT');
    add(payload.payableAccountCode || '2230', 0, gross, 'EMPLOYEE_PAYABLE');
  } else if (eventType === 'MANUFACTURING_MATERIAL_ISSUE') {
    add(payload.wipAccountCode || '1230', cost, 0, 'WORK_IN_PROCESS');
    add(inventoryAccount, 0, cost, 'MATERIAL_INVENTORY');
  } else if (eventType === 'MANUFACTURING_OUTPUT') {
    add(payload.finishedGoodsAccountCode || '1240', cost, 0, 'FINISHED_GOODS');
    add(payload.wipAccountCode || '1230', 0, cost, 'WORK_IN_PROCESS');
  } else if (eventType === 'MAINTENANCE_COST') {
    add(payload.expenseAccountCode || '6510', net || cost || gross, 0, 'MAINTENANCE_EXPENSE');
    add('1150', tax, 0, 'INPUT_VAT');
    add(payload.payableAccountCode || '2000', 0, gross || cost, 'PAYABLE');
  } else if (eventType === 'TRANSPORT_BILL') {
    add(payload.expenseAccountCode || '6530', net || gross, 0, 'LOGISTICS_EXPENSE');
    add('1150', tax, 0, 'INPUT_VAT');
    add(payload.payableAccountCode || '2000', 0, gross, 'PAYABLE');
  } else if (eventType === 'EMPLOYEE_DEVELOPMENT_COST') {
    add(payload.expenseAccountCode || '6540', net || gross, 0, 'EMPLOYEE_DEVELOPMENT_EXPENSE');
    add('1150', tax, 0, 'INPUT_VAT');
    add(payload.payableAccountCode || '2000', 0, gross, 'PAYABLE');
  } else if (eventType === 'FUND_UTILIZATION') {
    add(payload.expenseAccountCode || '6520', gross, 0, 'FUND_EXPENSE');
    add(payload.fundAccountCode || '1010', 0, gross, 'RESTRICTED_FUND_CASH');
  } else if (eventType === 'PAYROLL_DETAILED') {
    const deductions = round(payload.deductionAmount ?? tax);
    const netPay = round(payload.netAmount ?? (gross - deductions));
    add(payload.payrollExpenseAccountCode || '6000', gross, 0, 'PAYROLL_EXPENSE');
    add(payload.employeePayableAccountCode || '2200', 0, netPay, 'NET_PAYABLE');
    add(payload.deductionPayableAccountCode || '2240', 0, deductions, 'PAYROLL_DEDUCTIONS');
  } else if (eventType === 'PROJECT_COST') {
    add(payload.expenseAccountCode || '6520', net || gross, 0, 'PROJECT_COST');
    add('1150', tax, 0, 'INPUT_VAT');
    add(payload.payableAccountCode || '2000', 0, gross, 'PAYABLE');
  } else if (eventType === 'PAYROLL') {
    add('6000', gross, 0, 'PAYROLL_EXPENSE');
    add('2120', 0, tax, 'WITHHOLDING');
    add('2200', 0, round(gross - tax), 'PAYROLL_PAYABLE');
  } else if (eventType === 'BANK_CHARGE') {
    add('6700', gross, 0, 'BANK_CHARGE');
    add(payload.bankAccountCode || '1010', 0, gross, 'BANK');
  } else if (eventType === 'OPENING_INVENTORY') {
    add(inventoryAccount, cost, 0, 'INVENTORY');
    add(payload.offsetAccountCode || '3100', 0, cost, 'OPENING_EQUITY');
  } else if (eventType === 'OPENING_BANK_BALANCE') {
    add(payload.bankAccountCode || '1010', gross, 0, 'BANK');
    add(payload.offsetAccountCode || '3100', 0, gross, 'OPENING_EQUITY');
  }
  return lines;
}

export async function createJournal(db, input, userEmail) {
  const entity = await entityByCode(db, input.entityCode || 'E88');
  if (!entity) throw new Error('Accounting entity is not configured.');
  const journalDate = (normalizeText(input.journalDate) || new Date().toISOString()).slice(0, 10);
  const period = await ensureAccountingPeriod(db, entity.id, journalDate);
  if (period.status === 'CLOSED') throw new Error(`Accounting period ${period.period_name} is closed.`);
  const rawLines = Array.isArray(input.lines) ? input.lines : [];
  if (rawLines.length < 2) throw new Error('A journal requires at least two lines.');
  const lines = [];
  let totalDebit = 0;
  let totalCredit = 0;
  for (const raw of rawLines) {
    const account = await accountByCode(db, raw.accountCode);
    if (!account) throw new Error(`Account ${raw.accountCode || '(blank)'} is not active.`);
    if (normalizeText(input.sourceType).toUpperCase() === 'MANUAL_JOURNAL' && !account.allow_manual_posting) {
      throw new Error(`${account.account_code} ${account.account_name} is a system control account.`);
    }
    const debit = round(raw.debit);
    const credit = round(raw.credit);
    if (debit < 0 || credit < 0 || (debit && credit) || (!debit && !credit)) {
      throw new Error(`Journal line for ${account.account_code} must have either a debit or a credit.`);
    }
    totalDebit = round(totalDebit + debit);
    totalCredit = round(totalCredit + credit);
    lines.push({ ...raw, account, debit, credit });
  }
  if (Math.abs(totalDebit - totalCredit) > 0.005) {
    throw new Error(`Journal is not balanced. Debit ${totalDebit.toFixed(2)}; credit ${totalCredit.toFixed(2)}.`);
  }
  if (totalDebit <= 0) throw new Error('Journal total must be greater than zero.');
  if (input.sourceEventKey) {
    const existing = await first(db, `SELECT * FROM erp_journal_headers WHERE source_event_key=?`, [
      input.sourceEventKey,
    ]);
    if (existing) return existing;
  }
  const journalNo = normalizeText(input.journalNo) || await nextCode(db, 'JOURNAL', 'JE', 8);
  const inserted = await run(db,
    `INSERT INTO erp_journal_headers(
      journal_no,entity_id,journal_date,period_id,journal_type,source_module,source_type,
      source_id,source_no,source_event_key,description,currency,exchange_rate,total_debit,total_credit,
      status,created_by,submitted_by,submitted_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, ?,?,?,CASE WHEN ?='SUBMITTED' THEN datetime('now') ELSE NULL END)`,
    [
      journalNo, entity.id, journalDate, period.id, input.journalType || 'GENERAL',
      input.sourceModule || 'FINANCE', input.sourceType || '', input.sourceId || null,
      input.sourceNo || '', input.sourceEventKey || null, normalizeText(input.description) || journalNo,
      input.currency || entity.base_currency, Number(input.exchangeRate || 1), totalDebit, totalCredit,
      input.status || 'DRAFT', userEmail, (input.status || 'DRAFT') === 'SUBMITTED' ? userEmail : null,
      input.status || 'DRAFT',
    ]);
  const journalId = inserted.meta.last_row_id;
  let lineNo = 0;
  for (const line of lines) {
    lineNo += 1;
    const baseDebit = round(line.debit * Number(input.exchangeRate || 1));
    const baseCredit = round(line.credit * Number(input.exchangeRate || 1));
    await run(db,
      `INSERT INTO erp_journal_lines(
        journal_id,line_no,account_id,partner_id,department,cost_center,business_line,project_code,
        description,debit,credit,base_debit,base_credit,tax_code_id,tax_base,asset_id,serial_no,
        item_id,due_date
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        journalId, lineNo, line.account.id, line.partnerId || input.partnerId || null,
        line.department || input.department || '', line.costCenter || input.costCenter || '',
        line.businessLine || input.businessLine || '', line.projectCode || input.projectCode || '',
        normalizeText(line.description || input.description), line.debit, line.credit, baseDebit, baseCredit,
        line.taxCodeId || null, Number(line.taxBase || 0), line.assetId || null,
        normalizeText(line.serialNo), line.itemId || null, normalizeText(line.dueDate || input.dueDate),
      ]);
  }
  return first(db, `SELECT * FROM erp_journal_headers WHERE id=?`, [journalId]);
}

async function prepareFinanceEventJournal(db, eventId, input, payload, userEmail) {
  const eventKey = normalizeText(input.eventKey);
  const eventDate = (normalizeText(input.eventDate) || new Date().toISOString()).slice(0, 10);
  try {
    const lines = eventLines(input.eventType, payload);
    if (!lines.length) throw new Error(`No posting rule is configured for ${input.eventType}.`);
    const journal = await createJournal(db, {
      entityCode:input.entityCode || 'E88',
      journalDate:eventDate,
      journalType:input.journalType || 'SYSTEM',
      sourceModule:input.sourceModule,
      sourceType:input.sourceType,
      sourceId:input.sourceId,
      sourceNo:input.sourceNo,
      sourceEventKey:eventKey,
      description:input.description || `${input.eventType} ${input.sourceNo || ''}`.trim(),
      currency:input.currency || 'PHP',
      partnerId:input.partnerId,
      department:input.department,
      costCenter:input.costCenter,
      businessLine:input.businessLine,
      dueDate:payload.dueDate,
      status:'SUBMITTED',
      lines:lines.map(line => ({
        ...line,
        partnerId:input.partnerId,
        department:input.department,
        costCenter:input.costCenter,
        businessLine:input.businessLine,
        description:input.description,
        assetId:payload.assetId,
        serialNo:payload.serialNo,
        itemId:payload.itemId,
        dueDate:payload.dueDate,
      })),
    }, userEmail);
    await run(db,
      `UPDATE erp_finance_source_events
        SET status='JOURNAL_PREPARED',journal_id=?,processed_by=?,processed_at=datetime('now')
        WHERE id=?`,
      [journal.id, userEmail, eventId]);
  } catch (error) {
    await run(db,
      `UPDATE erp_finance_source_events SET status='ERROR',error_message=? WHERE id=?`,
      [String(error.message || error), eventId]);
  }
  return first(db, `SELECT * FROM erp_finance_source_events WHERE id=?`, [eventId]);
}

export async function captureFinanceEvent(db, input, userEmail) {
  const eventKey = normalizeText(input.eventKey);
  if (!eventKey) throw new Error('Finance event key is required.');
  const existing = await first(db, `SELECT * FROM erp_finance_source_events WHERE event_key=?`, [eventKey]);
  if (existing) {
    if (existing.status !== 'ERROR') return existing;
    const retryPayload = { ...JSON.parse(existing.payload_json || '{}'), ...(input.payload || {}) };
    await run(db,
      `UPDATE erp_finance_source_events SET status='CAPTURED',error_message=NULL,
        retry_count=retry_count+1,last_retry_at=datetime('now') WHERE id=?`,
      [existing.id]);
    return prepareFinanceEventJournal(db, existing.id, {
      ...input, eventKey:existing.event_key, eventType:existing.event_type,
      eventDate:existing.event_date, entityCode:existing.entity_code,
      sourceModule:existing.source_module, sourceType:existing.source_type,
      sourceId:existing.source_id, sourceNo:existing.source_no,
      partnerId:existing.partner_id, department:existing.department,
      costCenter:existing.cost_center, businessLine:existing.business_line,
      currency:existing.currency,
    }, retryPayload, userEmail);
  }
  const payload = { ...(input.payload || {}), amount:round(input.amount), taxAmount:round(input.taxAmount) };
  const financialEffect = input.financialEffect || 'ACCOUNTING';
  const eventDate = (normalizeText(input.eventDate) || new Date().toISOString()).slice(0, 10);
  const inserted = await run(db,
    `INSERT INTO erp_finance_source_events(
      event_key,event_type,source_module,source_type,source_id,source_no,event_date,entity_code,
      partner_id,department,cost_center,business_line,amount,tax_amount,currency,payload_json,
      financial_effect,status,captured_by
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      eventKey, input.eventType, input.sourceModule, input.sourceType, input.sourceId || null,
      input.sourceNo || '', eventDate,
      input.entityCode || 'E88', input.partnerId || null, input.department || '',
      input.costCenter || '', input.businessLine || '', round(input.amount), round(input.taxAmount),
      input.currency || 'PHP', JSON.stringify(payload), financialEffect,
      financialEffect === 'NONE' ? 'NO_FINANCIAL_IMPACT' : 'CAPTURED', userEmail,
    ]);
  const eventId = inserted.meta.last_row_id;
  if (financialEffect === 'NONE') {
    return first(db, `SELECT * FROM erp_finance_source_events WHERE id=?`, [eventId]);
  }
  return prepareFinanceEventJournal(db, eventId, { ...input, eventKey, eventDate }, payload, userEmail);
}

export async function retryFinanceEvent(db, eventId, userEmail) {
  const event = await first(db, `SELECT * FROM erp_finance_source_events WHERE id=?`, [eventId]);
  if (!event) throw new Error('Finance source event not found.');
  if (event.status !== 'ERROR') throw new Error('Only an errored source event can be retried.');
  const payload = JSON.parse(event.payload_json || '{}');
  await run(db,
    `UPDATE erp_finance_source_events SET status='CAPTURED',error_message=NULL,
      retry_count=retry_count+1,last_retry_at=datetime('now') WHERE id=?`,
    [event.id]);
  return prepareFinanceEventJournal(db, event.id, {
    eventKey:event.event_key, eventType:event.event_type, sourceModule:event.source_module,
    sourceType:event.source_type, sourceId:event.source_id, sourceNo:event.source_no,
    eventDate:event.event_date, entityCode:event.entity_code, partnerId:event.partner_id,
    department:event.department, costCenter:event.cost_center, businessLine:event.business_line,
    currency:event.currency, description:`Retry ${event.event_type} ${event.source_no || ''}`.trim(),
  }, payload, userEmail);
}


export async function registerPendingFixedAsset(db, input, userEmail) {
  const asset = await first(db, `SELECT * FROM erp_assets WHERE id=? AND active=1`, [Number(input.assetId)]);
  if (!asset) throw new Error('Serialized asset not found for capitalization.');
  const existing = await first(db, `SELECT * FROM erp_fixed_asset_books WHERE asset_id=?`, [asset.id]);
  if (existing) return existing;
  const entity = await entityByCode(db, input.entityCode || 'E88');
  if (!entity) throw new Error('Accounting entity is not configured.');
  const acquisitionCost = round(input.acquisitionCost ?? asset.unit_cost);
  if (acquisitionCost <= 0) throw new Error(`Serial ${asset.serial_no} has no approved valuation.`);
  const result = await run(db,
    `INSERT INTO erp_fixed_asset_books(
      asset_id,entity_id,asset_class,capitalization_date,acquisition_cost,residual_value,useful_life_months,
      depreciation_method,accumulated_depreciation,net_book_value,asset_account_code,
      accumulated_depreciation_account_code,depreciation_expense_account_code,status,created_by,
      capitalization_event_id,capitalization_journal_id,source_delivery_id,ownership_status
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'PENDING_APPROVAL',?,?,?,?,?)`,
    [asset.id,entity.id,input.assetClass,input.capitalizationDate,acquisitionCost,
      round(input.residualValue),Number(input.usefulLifeMonths||36),input.depreciationMethod||'STRAIGHT_LINE',
      0,acquisitionCost,input.assetAccountCode||'1310',
      input.accumulatedDepreciationAccountCode||'1390',input.depreciationExpenseAccountCode||'6800',
      userEmail,input.capitalizationEventId||null,input.capitalizationJournalId||null,
      input.sourceDeliveryId||null,'COMPANY_OWNED']);
  await run(db, `UPDATE erp_assets SET capitalization_status='PENDING_APPROVAL',
    placed_in_service_date=?,updated_at=datetime('now') WHERE id=?`, [input.capitalizationDate,asset.id]);
  return first(db, `SELECT * FROM erp_fixed_asset_books WHERE id=?`, [result.meta.last_row_id]);
}

export async function submitJournal(db, journalId, userEmail) {
  const journal = await first(db, `SELECT * FROM erp_journal_headers WHERE id=?`, [journalId]);
  if (!journal) throw new Error('Journal not found.');
  if (journal.status !== 'DRAFT') throw new Error('Only a draft journal can be submitted.');
  await run(db,
    `UPDATE erp_journal_headers
      SET status='SUBMITTED',submitted_by=?,submitted_at=datetime('now'),updated_at=datetime('now')
      WHERE id=?`,
    [userEmail, journalId]);
  return first(db, `SELECT * FROM erp_journal_headers WHERE id=?`, [journalId]);
}

export async function approveJournal(db, journalId, userEmail) {
  const journal = await first(db, `SELECT * FROM erp_journal_headers WHERE id=?`, [journalId]);
  if (!journal) throw new Error('Journal not found.');
  if (journal.status !== 'SUBMITTED') throw new Error('Only a submitted journal can be approved.');
  if (journal.created_by === userEmail || journal.submitted_by === userEmail) {
    throw new Error('The journal preparer cannot approve the same journal.');
  }
  await run(db,
    `UPDATE erp_journal_headers
      SET status='APPROVED',approved_by=?,approved_at=datetime('now'),updated_at=datetime('now')
      WHERE id=?`,
    [userEmail, journalId]);
  return first(db, `SELECT * FROM erp_journal_headers WHERE id=?`, [journalId]);
}

export async function postJournal(db, journalId, userEmail) {
  const journal = await first(db,
    `SELECT h.*,p.status period_status,p.period_name
      FROM erp_journal_headers h
      LEFT JOIN erp_accounting_periods p ON p.id=h.period_id WHERE h.id=?`,
    [journalId]);
  if (!journal) throw new Error('Journal not found.');
  if (journal.status !== 'APPROVED') throw new Error('Only an approved journal can be posted.');
  if (journal.period_status === 'CLOSED') throw new Error(`Accounting period ${journal.period_name} is closed.`);
  const totals = await first(db,
    `SELECT ROUND(COALESCE(SUM(base_debit),0),2) debit,
            ROUND(COALESCE(SUM(base_credit),0),2) credit
       FROM erp_journal_lines WHERE journal_id=?`,
    [journalId]);
  if (Math.abs(Number(totals?.debit || 0) - Number(totals?.credit || 0)) > 0.005) {
    throw new Error('Journal lines are not balanced.');
  }
  await run(db,
    `UPDATE erp_journal_headers
      SET status='POSTED',posted_by=?,posted_at=datetime('now'),updated_at=datetime('now')
      WHERE id=?`,
    [userEmail, journalId]);
  await run(db,
    `UPDATE erp_finance_source_events
      SET status='POSTED',processed_by=?,processed_at=datetime('now')
      WHERE journal_id=?`,
    [userEmail, journalId]);
  await run(db,
    `UPDATE erp_fixed_asset_books SET status='ACTIVE'
      WHERE capitalization_journal_id=? AND status='PENDING_APPROVAL'`,
    [journalId]);
  await run(db,
    `UPDATE erp_assets SET capitalization_status='CAPITALIZED',updated_at=datetime('now')
      WHERE id IN (SELECT asset_id FROM erp_fixed_asset_books WHERE capitalization_journal_id=? AND status='ACTIVE')`,
    [journalId]);
  await run(db,
    `UPDATE erp_assets SET
      unit_cost=(SELECT proposed_unit_cost FROM erp_inventory_valuation_exceptions x
        WHERE x.asset_id=erp_assets.id AND x.journal_id=? AND x.status='PENDING_POSTING' LIMIT 1),
      acquisition_cost=(SELECT proposed_unit_cost FROM erp_inventory_valuation_exceptions x
        WHERE x.asset_id=erp_assets.id AND x.journal_id=? AND x.status='PENDING_POSTING' LIMIT 1),
      landed_cost=(SELECT proposed_unit_cost FROM erp_inventory_valuation_exceptions x
        WHERE x.asset_id=erp_assets.id AND x.journal_id=? AND x.status='PENDING_POSTING' LIMIT 1),
      cost_source='APPROVED_VALUATION',valuation_status='VALUED',updated_at=datetime('now')
      WHERE id IN (SELECT asset_id FROM erp_inventory_valuation_exceptions
        WHERE journal_id=? AND status='PENDING_POSTING')`,
    [journalId,journalId,journalId,journalId]);
  await run(db,
    `UPDATE erp_inventory_valuation_exceptions SET status='RESOLVED',resolved_by=?,resolved_at=datetime('now'),
      resolution_notes=trim(COALESCE(resolution_notes,'')||' Posted through journal '||?)
      WHERE journal_id=? AND status='PENDING_POSTING'`,
    [userEmail,journal.journal_no,journalId]);
  await run(db,
    `UPDATE erp_subledger_documents
      SET status='POSTED',posted_by=?,posted_at=datetime('now')
      WHERE journal_id=? AND status='SUBMITTED'`,
    [userEmail, journalId]);
  return first(db, `SELECT * FROM erp_journal_headers WHERE id=?`, [journalId]);
}

export async function reversePostedJournal(db, journalId, userEmail, requestNo) {
  const original = await first(db, `SELECT * FROM erp_journal_headers WHERE id=?`, [journalId]);
  if (!original) throw new Error('Journal not found.');
  if (original.status !== 'POSTED') throw new Error('Only a posted journal can be reversed.');
  const existing = await first(db, `SELECT * FROM erp_journal_headers WHERE reversal_of_id=?`, [journalId]);
  if (existing) return existing;
  const lines = await all(db,
    `SELECT l.*,a.account_code FROM erp_journal_lines l
      JOIN erp_chart_accounts a ON a.id=l.account_id
      WHERE l.journal_id=? ORDER BY l.line_no`,
    [journalId]);
  const reversal = await createJournal(db, {
    entityCode:(await first(db, `SELECT entity_code FROM erp_legal_entities WHERE id=?`, [original.entity_id]))?.entity_code,
    journalDate:new Date().toISOString().slice(0, 10),
    journalType:'REVERSAL',
    sourceModule:'FINANCE',
    sourceType:'JOURNAL_REVERSAL',
    sourceId:journalId,
    sourceNo:original.journal_no,
    sourceEventKey:`REVERSAL:${journalId}:${requestNo}`,
    description:`Reversal of ${original.journal_no}`,
    status:'DRAFT',
    lines:lines.map(line => ({
      accountCode:line.account_code,
      debit:line.base_credit,
      credit:line.base_debit,
      partnerId:line.partner_id,
      department:line.department,
      costCenter:line.cost_center,
      businessLine:line.business_line,
      projectCode:line.project_code,
      description:`Reversal: ${line.description || original.description}`,
      assetId:line.asset_id,
      serialNo:line.serial_no,
      itemId:line.item_id,
    })),
  }, userEmail);
  await run(db,
    `UPDATE erp_journal_headers
      SET reversal_of_id=?,status='POSTED',approved_by=?,approved_at=datetime('now'),
          posted_by=?,posted_at=datetime('now')
      WHERE id=?`,
    [journalId, userEmail, userEmail, reversal.id]);
  await run(db,
    `UPDATE erp_journal_headers
      SET status='REVERSED',reversed_by=?,reversed_at=datetime('now'),updated_at=datetime('now')
      WHERE id=?`,
    [userEmail, journalId]);
  await run(db,
    `UPDATE erp_finance_source_events
      SET status='REVERSED',processed_by=?,processed_at=datetime('now')
      WHERE journal_id=?`,
    [userEmail, journalId]);
  await run(db,
    `UPDATE erp_subledger_documents
      SET status='REVERSED',open_balance=0
      WHERE journal_id=?`,
    [journalId]);
  await run(db,
    `UPDATE erp_assets SET unit_cost=(SELECT current_unit_cost FROM erp_inventory_valuation_exceptions x
        WHERE x.asset_id=erp_assets.id AND x.journal_id=? LIMIT 1),
      acquisition_cost=(SELECT current_unit_cost FROM erp_inventory_valuation_exceptions x
        WHERE x.asset_id=erp_assets.id AND x.journal_id=? LIMIT 1),
      landed_cost=(SELECT current_unit_cost FROM erp_inventory_valuation_exceptions x
        WHERE x.asset_id=erp_assets.id AND x.journal_id=? LIMIT 1),
      cost_source='VALUATION_REVERSED',valuation_status=CASE WHEN
        (SELECT current_unit_cost FROM erp_inventory_valuation_exceptions x
          WHERE x.asset_id=erp_assets.id AND x.journal_id=? LIMIT 1)>0 THEN 'VALUED' ELSE 'UNVALUED' END,
      updated_at=datetime('now')
      WHERE id IN (SELECT asset_id FROM erp_inventory_valuation_exceptions WHERE journal_id=?)`,
    [journalId,journalId,journalId,journalId,journalId]);
  await run(db,
    `UPDATE erp_inventory_valuation_exceptions SET status='REVERSED',resolved_by=?,resolved_at=datetime('now'),
      resolution_notes=trim(COALESCE(resolution_notes,'')||' Reversed through journal '||?)
      WHERE journal_id=?`,
    [userEmail,reversal.journal_no,journalId]);
  await run(db,
    `UPDATE erp_fixed_asset_books SET status='REVERSED'
      WHERE capitalization_journal_id=? AND status IN ('ACTIVE','PENDING_APPROVAL')`,
    [journalId]);
  await run(db,
    `UPDATE erp_assets SET capitalization_status='INVENTORY',placed_in_service_date=NULL,updated_at=datetime('now')
      WHERE id IN (SELECT asset_id FROM erp_fixed_asset_books WHERE capitalization_journal_id=?)`,
    [journalId]);
  if (original.source_type === 'DEPRECIATION_RUN' && original.source_id) {
    const depreciationLines = await all(db, `SELECT * FROM erp_depreciation_lines WHERE depreciation_run_id=?`, [original.source_id]);
    for (const line of depreciationLines) {
      await run(db, `UPDATE erp_fixed_asset_books SET
        accumulated_depreciation=MAX(0,accumulated_depreciation-?),
        net_book_value=MIN(acquisition_cost,net_book_value+?),last_depreciation_date=NULL
        WHERE id=?`, [line.depreciation_amount,line.depreciation_amount,line.fixed_asset_book_id]);
    }
    await run(db, `UPDATE erp_depreciation_runs SET status='REVERSED' WHERE id=?`, [original.source_id]);
  }
  await run(db,
    `INSERT OR IGNORE INTO erp_finance_source_events(
      event_key,event_type,source_module,source_type,source_id,source_no,event_date,entity_code,
      amount,currency,payload_json,financial_effect,status,journal_id,captured_by,processed_by,processed_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`,
    [
      `REVERSAL:${journalId}:${requestNo}`, 'JOURNAL_REVERSAL', 'FINANCE', 'CHANGE_REQUEST',
      journalId, original.journal_no, new Date().toISOString().slice(0, 10),
      (await first(db, `SELECT entity_code FROM erp_legal_entities WHERE id=?`, [original.entity_id]))?.entity_code || 'E88',
      original.total_debit, original.currency,
      JSON.stringify({ originalJournalId:journalId, originalJournalNo:original.journal_no, requestNo }),
      'ACCOUNTING', 'POSTED', reversal.id, userEmail, userEmail,
    ]);
  return first(db, `SELECT * FROM erp_journal_headers WHERE id=?`, [reversal.id]);
}

export function calculateAgingBucket(dueDate, asOf) {
  if (!dueDate) return 'CURRENT';
  const due = new Date(`${dueDate}T00:00:00Z`);
  const target = new Date(`${asOf}T00:00:00Z`);
  const days = Math.floor((target - due) / 86400000);
  if (days <= 0) return 'CURRENT';
  if (days <= 30) return '1-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return 'OVER_90';
}

export async function createSubledgerDocument(db, input, userEmail) {
  const entity = await entityByCode(db, input.entityCode || 'E88');
  if (!entity) throw new Error('Accounting entity is not configured.');
  const partner = await first(db, `SELECT * FROM erp_partners WHERE id=?`, [Number(input.partnerId)]);
  if (!partner) throw new Error('Customer or supplier is required.');
  const type = normalizeText(input.documentType).toUpperCase();
  const isCustomer = ['CUSTOMER_INVOICE','CUSTOMER_CREDIT','CUSTOMER_RECEIPT','LEASE_BILLING'].includes(type);
  const isPayment = ['CUSTOMER_RECEIPT','SUPPLIER_PAYMENT'].includes(type);
  const prefix = isCustomer ? 'AR' : 'AP';
  const seq = isCustomer ? 'AR_DOCUMENT' : 'AP_DOCUMENT';
  const documentNo = normalizeText(input.documentNo) || await nextCode(db, seq, prefix, 8);
  const gross = round(input.grossAmount);
  const tax = round(input.taxAmount);
  const withholding = round(input.withholdingAmount);
  const net = round(input.netAmount ?? (gross - tax));
  const openBalance = isPayment ? 0 : round(gross - withholding);
  const inserted = await run(db,
    `INSERT INTO erp_subledger_documents(
      document_no,entity_id,document_type,partner_id,document_date,due_date,currency,exchange_rate,
      gross_amount,net_amount,vat_amount,withholding_amount,open_balance,department,cost_center,
      business_line,source_type,source_id,source_no,status,created_by
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'DRAFT',?)`,
    [
      documentNo, entity.id, type, partner.id, input.documentDate, input.dueDate || '',
      input.currency || 'PHP', Number(input.exchangeRate || 1), gross, net, tax, withholding,
      openBalance, input.department || '', input.costCenter || '', input.businessLine || '',
      input.sourceType || 'FINANCE', input.sourceId || null, input.sourceNo || '', userEmail,
    ]);
  return first(db, `SELECT * FROM erp_subledger_documents WHERE id=?`, [inserted.meta.last_row_id]);
}

export async function postSubledgerDocument(db, documentId, input, userEmail) {
  const document = await first(db,
    `SELECT d.*,e.entity_code,p.name partner_name FROM erp_subledger_documents d
      JOIN erp_legal_entities e ON e.id=d.entity_id
      JOIN erp_partners p ON p.id=d.partner_id WHERE d.id=?`,
    [documentId]);
  if (!document) throw new Error('Subledger document not found.');
  if (document.status !== 'DRAFT') throw new Error('Only a draft subledger document can be posted.');
  const eventType = document.document_type === 'LEASE_BILLING' ? 'LEASE_BILLING' : document.document_type;
  const event = await captureFinanceEvent(db, {
    eventKey:`SUBLEDGER:${document.id}:${eventType}`,
    eventType,
    sourceModule:'FINANCE',
    sourceType:'SUBLEDGER_DOCUMENT',
    sourceId:document.id,
    sourceNo:document.document_no,
    eventDate:document.document_date,
    entityCode:document.entity_code,
    partnerId:document.partner_id,
    department:document.department,
    costCenter:document.cost_center,
    businessLine:document.business_line,
    amount:document.gross_amount,
    taxAmount:document.vat_amount,
    description:`${document.document_type.replaceAll('_',' ')} - ${document.partner_name}`,
    payload:{
      grossAmount:document.gross_amount,netAmount:document.net_amount,
      taxAmount:document.vat_amount,withholdingAmount:document.withholding_amount,
      dueDate:document.due_date,expenseAccountCode:input?.accountCode,
      debitAccountCode:input?.accountCode,revenueAccountCode:input?.accountCode,
      bankAccountCode:input?.bankAccountCode,
    },
  }, userEmail);
  if (event.status === 'ERROR') throw new Error(event.error_message);
  await run(db,
    `UPDATE erp_subledger_documents SET journal_id=?,status='SUBMITTED' WHERE id=?`,
    [event.journal_id, documentId]);
  return first(db, `SELECT * FROM erp_subledger_documents WHERE id=?`, [documentId]);
}
