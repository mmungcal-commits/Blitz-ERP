import { Hono } from 'hono';
import { all, first } from '../lib/db.js';
import { ok } from '../lib/http.js';
import { requirePermission } from '../lib/auth.js';

export const analyticsRoutes = new Hono();

const round = n => Math.round((Number(n) || 0) * 100) / 100;
const todayISO = () => new Date().toISOString().slice(0, 10);
const yearStart = () => `${new Date().getFullYear()}-01-01`;

// Catalog of reports. dateMode drives how the UI presents the date control:
//  RANGE  = needs dateFrom + dateTo (flow reports: P&L, GL, sales, tax, cash flow)
//  AS_OF  = needs a single as-of date (balance reports: balance sheet, TB, aging, valuation)
//  NONE   = no date control
const REPORT_CATALOG = [
  // Financial
  { id: 'income-statement', name: 'Income Statement (P&L)', category: 'Financial', dateMode: 'RANGE',
    endpoint: '/api/finance/reports/financial-statements', dateParams: ['dateFrom', 'dateTo'], note: 'Revenue, COGS, expenses for the period.' },
  { id: 'balance-sheet', name: 'Balance Sheet', category: 'Financial', dateMode: 'AS_OF',
    endpoint: '/api/finance/reports/financial-statements', dateParams: ['dateTo'], note: 'Assets, liabilities, equity as of a date.' },
  { id: 'trial-balance', name: 'Trial Balance', category: 'Financial', dateMode: 'AS_OF',
    endpoint: '/api/finance/reports/trial-balance', dateParams: ['dateTo'], note: 'All account balances as of a date.' },
  { id: 'general-ledger', name: 'General Ledger', category: 'Financial', dateMode: 'RANGE',
    endpoint: '/api/finance/reports/general-ledger', dateParams: ['dateFrom', 'dateTo'], note: 'All posted journal lines in the period.' },
  { id: 'budget-actual', name: 'Budget vs Actual', category: 'Financial', dateMode: 'RANGE',
    endpoint: '/api/finance/reports/budget-actual', dateParams: ['year'], note: 'Budget compared to actuals by year.' },
  // Receivables / Payables
  { id: 'ar-aging', name: 'AR Aging', category: 'Receivables', dateMode: 'AS_OF',
    endpoint: '/api/finance/aging/AR', dateParams: ['asOf'], note: 'Customer balances by age bucket.' },
  { id: 'ap-aging', name: 'AP Aging', category: 'Payables', dateMode: 'AS_OF',
    endpoint: '/api/finance/aging/AP', dateParams: ['asOf'], note: 'Supplier balances by age bucket.' },
  // Tax
  { id: 'tax-summary', name: 'VAT / Tax Summary', category: 'Tax', dateMode: 'RANGE',
    endpoint: '/api/finance/reports/tax-summary', dateParams: ['dateFrom', 'dateTo'], note: 'Output/input VAT for the period.' },
  // Inventory
  { id: 'inventory-by-class', name: 'Inventory by Class', category: 'Inventory', dateMode: 'AS_OF',
    endpoint: '/api/inventory/by-class', dateParams: ['from', 'to'], note: 'On-hand and value per class (optional movement range).' },
  { id: 'inventory-reconciliation', name: 'Inventory Reconciliation', category: 'Inventory', dateMode: 'AS_OF',
    endpoint: '/api/finance/reports/inventory-reconciliation', dateParams: [], note: 'Subledger vs GL, per class.' },
  // Sales
  { id: 'sales-units-by-month', name: 'Sales Units by Month', category: 'Sales', dateMode: 'RANGE',
    endpoint: '/api/sales/reports/units-by-month', dateParams: ['from', 'to'], note: 'Units sold/leased by month.' },
];

analyticsRoutes.get('/catalog', requirePermission('FINANCE', 'VIEW'), async (c) => {
  const categories = {};
  for (const r of REPORT_CATALOG) (categories[r.category] ||= []).push(r);
  return ok(c, { reports: REPORT_CATALOG, categories, dateModes: { RANGE: 'dateFrom + dateTo', AS_OF: 'single as-of date', NONE: 'no date filter' } });
});

// Date-range KPI summary computed from the posted GL for the selected period.
analyticsRoutes.get('/kpis', requirePermission('FINANCE', 'VIEW'), async (c) => {
  const entity = (c.req.query('entity') || 'E88').toUpperCase();
  const dateFrom = c.req.query('dateFrom') || yearStart();
  const dateTo = c.req.query('dateTo') || todayISO();
  const rows = await all(c.env.DB,
    `SELECT a.account_type type, ROUND(SUM(l.base_debit),2) dr, ROUND(SUM(l.base_credit),2) cr
       FROM erp_journal_headers h
       JOIN erp_legal_entities e ON e.id=h.entity_id
       JOIN erp_journal_lines l ON l.journal_id=h.id
       JOIN erp_chart_accounts a ON a.id=l.account_id
      WHERE h.status='POSTED' AND e.entity_code=? AND h.journal_date BETWEEN ? AND ?
      GROUP BY a.account_type`, [entity, dateFrom, dateTo]);
  const by = Object.fromEntries(rows.map(r => [r.type, r]));
  const revenue = round((by.REVENUE?.cr || 0) - (by.REVENUE?.dr || 0));
  const cogs = round((by.COGS?.dr || 0) - (by.COGS?.cr || 0));
  const opex = round((by.EXPENSE?.dr || 0) - (by.EXPENSE?.cr || 0));
  const grossProfit = round(revenue - cogs);
  const netIncome = round(grossProfit - opex);
  const units = await first(c.env.DB,
    `SELECT COUNT(*) n FROM erp_sales_lines sl JOIN erp_sales_orders so ON so.id=sl.sales_order_id
      WHERE so.status='POSTED' AND date(so.order_date) BETWEEN ? AND ?`, [dateFrom, dateTo]);
  return ok(c, {
    period: { dateFrom, dateTo, entity },
    kpis: {
      revenue, cogs, grossProfit,
      grossMarginPct: revenue ? round((grossProfit / revenue) * 100) : 0,
      operatingExpenses: opex, netIncome,
      netMarginPct: revenue ? round((netIncome / revenue) * 100) : 0,
      unitsSold: Number(units?.n || 0),
    },
  });
});
