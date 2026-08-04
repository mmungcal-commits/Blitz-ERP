import { Hono } from 'hono';
import { all, first, run } from '../lib/db.js';
import { ok, fail, jsonBody, numberValue } from '../lib/http.js';
import { requirePermission } from '../lib/auth.js';
import { nextCode, normalizeText, normalizeSerial } from '../lib/codes.js';
import { audit } from '../lib/audit.js';

export const assemblyRoutes = new Hono();

assemblyRoutes.get('/', requirePermission('INVENTORY','VIEW'), async c => {
  const rows = await all(c.env.DB, `SELECT * FROM erp_assemblies ORDER BY id DESC LIMIT 500`);
  const comps = await all(c.env.DB, `SELECT * FROM erp_assembly_components ORDER BY id`);
  const byAsm = {};
  for (const k of comps) (byAsm[k.assembly_id] ||= []).push(k);
  return ok(c, { rows: rows.map(r => ({ ...r, components: byAsm[r.id] || [] })) });
});

assemblyRoutes.post('/build', requirePermission('INVENTORY','CREATE'), async c => {
  const b = await jsonBody(c);
  const comps = (Array.isArray(b.components) ? b.components : []).filter(x => normalizeText(x.itemName || x.itemCode) && numberValue(x.qty) > 0);
  if (!comps.length) return fail(c, 'Add at least one component to build an assembly.');
  const outName = normalizeText(b.outputItemName) || 'Assembly';
  const total = comps.reduce((s, x) => s + numberValue(x.qty) * numberValue(x.unitCost), 0);
  const no = await nextCode(c.env.DB, 'ASSEMBLY', 'ASM', 6);
  const r = await run(c.env.DB, `INSERT INTO erp_assemblies(assembly_no,output_item_name,location_id,location_code,status,total_cost,component_count,notes,built_by) VALUES(?,?,?,?,'BUILT',?,?,?,?)`,
    [no, outName, b.locationId ? Number(b.locationId) : null, normalizeText(b.locationCode), Math.round(total*100)/100, comps.length, normalizeText(b.notes), c.get('erpUser').email]);
  const asmId = r.meta.last_row_id;
  for (const x of comps) {
    const serial = normalizeSerial(x.serialNo);
    const line = numberValue(x.qty) * numberValue(x.unitCost);
    let assetId = null, prior = null;
    if (serial) {
      const asset = await first(c.env.DB, `SELECT id,current_status FROM erp_assets WHERE serial_no=?`, [serial]);
      if (asset) { assetId = asset.id; prior = asset.current_status;
        await run(c.env.DB, `UPDATE erp_assets SET current_status='IN_ASSEMBLY', updated_at=datetime('now') WHERE id=?`, [asset.id]); }
    }
    await run(c.env.DB, `INSERT INTO erp_assembly_components(assembly_id,item_id,item_code,item_name,serial_no,qty,unit_cost,line_cost,asset_id,prior_status) VALUES(?,?,?,?,?,?,?,?,?,?)`,
      [asmId, x.itemId ? Number(x.itemId) : null, normalizeText(x.itemCode), normalizeText(x.itemName), serial, numberValue(x.qty), numberValue(x.unitCost), Math.round(line*100)/100, assetId, prior]);
  }
  await audit(c, { action:'CREATE', module:'INVENTORY', recordType:'ASSEMBLY', recordId:asmId, recordNo:no, after:{ outName, total } });
  return ok(c, { id:asmId, assemblyNo:no, totalCost:Math.round(total*100)/100 }, 201);
});

assemblyRoutes.post('/:id/disassemble', requirePermission('INVENTORY','CREATE'), async c => {
  const id = Number(c.req.param('id'));
  const asm = await first(c.env.DB, `SELECT * FROM erp_assemblies WHERE id=?`, [id]);
  if (!asm) return fail(c, 'Assembly not found', 404);
  if (asm.status !== 'BUILT') return fail(c, 'This assembly is already disassembled.', 409);
  const comps = await all(c.env.DB, `SELECT * FROM erp_assembly_components WHERE assembly_id=?`, [id]);
  for (const k of comps) {
    if (k.asset_id) await run(c.env.DB, `UPDATE erp_assets SET current_status=?, updated_at=datetime('now') WHERE id=?`, [k.prior_status || 'AVAILABLE', k.asset_id]);
  }
  await run(c.env.DB, `UPDATE erp_assemblies SET status='DISASSEMBLED', disassembled_at=datetime('now') WHERE id=?`, [id]);
  await audit(c, { action:'UPDATE', module:'INVENTORY', recordType:'ASSEMBLY', recordId:id, recordNo:asm.assembly_no, after:{ status:'DISASSEMBLED' } });
  return ok(c, { id, status:'DISASSEMBLED', restored: comps.filter(k=>k.asset_id).length });
});
