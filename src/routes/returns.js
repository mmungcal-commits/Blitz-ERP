import { Hono } from 'hono';
import { all, first, run } from '../lib/db.js';
import { ok, fail, jsonBody, pageParams } from '../lib/http.js';
import { requirePermission } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { ensureLocation, nextCode, normalizeSerial } from '../lib/codes.js';
import { getAsset, postMovement } from '../lib/inventory.js';

export const returnRoutes = new Hono();

returnRoutes.get('/', requirePermission('RETURNS','VIEW'), async(c)=>{
  const {page,size,offset}=pageParams(c); const status=c.req.query('status')||''; const args=[]; let where='';
  if(status){where='WHERE r.status=?';args.push(status);}
  const rows=await all(c.env.DB,`SELECT r.*,a.assignment_no,p.name partner_name,l.code return_location_code,
    (SELECT COUNT(*) FROM erp_return_lines x WHERE x.return_id=r.id) line_count,
    (SELECT COUNT(*) FROM erp_return_lines x WHERE x.return_id=r.id AND x.acceptance_status!='MATCHED') exception_count
    FROM erp_return_orders r LEFT JOIN erp_assignments a ON a.id=r.assignment_id LEFT JOIN erp_partners p ON p.id=r.partner_id LEFT JOIN erp_locations l ON l.id=r.return_location_id
    ${where} ORDER BY r.return_date DESC,r.id DESC LIMIT ? OFFSET ?`,[...args,size,offset]);
  const total=await first(c.env.DB,`SELECT COUNT(*) n FROM erp_return_orders r ${where}`,args);
  return ok(c,{rows,page,size,total:total?.n||0});
});

returnRoutes.get('/assignments/active', requirePermission('RETURNS','VIEW'), async c=>{
  const rows=await all(c.env.DB,`SELECT a.*,p.name partner_name,r.id requisition_id,
    rc.holder_type,rc.holder_name,rc.expected_return_date,
    (SELECT COUNT(*) FROM erp_assignment_assets aa WHERE aa.assignment_id=a.id) asset_count
    FROM erp_assignments a
    LEFT JOIN erp_partners p ON p.id=a.partner_id
    LEFT JOIN erp_requisitions r ON r.requisition_no=a.source_request_no
    LEFT JOIN erp_requisition_context rc ON rc.requisition_id=r.id
    WHERE a.status IN ('APPROVED','ACTIVE','PARTIALLY_RETURNED') AND EXISTS(
      SELECT 1 FROM erp_assignment_assets aa
      WHERE aa.assignment_id=a.id
        AND NOT EXISTS(
          SELECT 1
          FROM erp_return_lines rl
          JOIN erp_return_orders ro ON ro.id=rl.return_id
          WHERE ro.assignment_id=a.id
            AND ro.status='POSTED'
            AND rl.expected_serial=aa.serial_no
        )
    )
    ORDER BY COALESCE(a.expected_return_date,a.start_date) ASC,a.id DESC`);
  const assets=await all(c.env.DB,`SELECT aa.assignment_id,aa.asset_id,aa.serial_no,aa.role_code,
    a.item_code,a.item_name,a.category,a.current_status,a.current_location_code,a.condition_code
    FROM erp_assignment_assets aa JOIN erp_assets a ON a.id=aa.asset_id
    JOIN erp_assignments h ON h.id=aa.assignment_id
    WHERE h.status IN ('APPROVED','ACTIVE','PARTIALLY_RETURNED')
      AND NOT EXISTS(
        SELECT 1
        FROM erp_return_lines rl
        JOIN erp_return_orders ro ON ro.id=rl.return_id
        WHERE ro.assignment_id=aa.assignment_id
          AND ro.status='POSTED'
          AND rl.expected_serial=aa.serial_no
      )
    ORDER BY aa.assignment_id,a.category,a.item_name,aa.serial_no`);
  return ok(c,{rows,assets});
});

returnRoutes.post('/', requirePermission('RETURNS','CREATE'), async(c)=>{
  const b=await jsonBody(c); const actual=(Array.isArray(b.lines)?b.lines:[]).map(x=>({...x,expectedSerial:normalizeSerial(x.expectedSerial),actualSerial:normalizeSerial(x.actualSerial)}));
  if(!actual.length)return fail(c,'At least one return line is required');
  const assignmentId=Number(b.assignmentId||0);
  if(!assignmentId)return fail(c,'Select the deployment or assignment being returned.');
  const assignment=await first(c.env.DB,`SELECT * FROM erp_assignments WHERE id=? AND status IN ('APPROVED','ACTIVE','PARTIALLY_RETURNED')`,[assignmentId]);
  if(!assignment)return fail(c,'The selected deployment is not active or returnable.',409);
  const assigned=await all(c.env.DB,`SELECT aa.*,a.category FROM erp_assignment_assets aa
    LEFT JOIN erp_assets a ON a.id=aa.asset_id
    WHERE aa.assignment_id=?
      AND NOT EXISTS(
        SELECT 1
        FROM erp_return_lines rl
        JOIN erp_return_orders ro ON ro.id=rl.return_id
        WHERE ro.assignment_id=aa.assignment_id
          AND ro.status='POSTED'
          AND rl.expected_serial=aa.serial_no
      )`,[assignmentId]);
  const assignedMap=new Map(assigned.map(row=>[row.serial_no,row]));
  for(const line of actual){
    if(!line.expectedSerial||!assignedMap.has(line.expectedSerial)){
      return fail(c,`Expected serial ${line.expectedSerial||'(blank)'} is not part of ${assignment.assignment_no}.`,409);
    }
    line.itemCategory=line.itemCategory||assignedMap.get(line.expectedSerial).category;
  }
  const loc=await ensureLocation(c.env.DB,b.returnLocationName||'Returns Quarantine',b.returnLocationType||'QUARANTINE',b.returnLocationCode||'RET-QUAR');
  const no=await nextCode(c.env.DB,'RETURN','RET',6);
  const rr=await run(c.env.DB,`INSERT INTO erp_return_orders(return_no,assignment_id,partner_id,return_date,return_location_id,status,reason_code,notes,created_by) VALUES(?,?,?,?,?,'DRAFT',?,?,?)`,[no,assignmentId,assignment.partner_id||b.partnerId||null,b.returnDate||new Date().toISOString(),loc.id,b.reasonCode||'',b.notes||'',c.get('erpUser').email]);
  const returnId=rr.meta.last_row_id; const results=[];

  for(const line of actual){
    const expectedAsset=line.expectedSerial?await getAsset(c.env.DB,line.expectedSerial):null;
    const actualAsset=line.actualSerial?await getAsset(c.env.DB,line.actualSerial):null;
    let acceptance='MATCHED'; let notes=line.notes||'';
    if(!actualAsset){acceptance='UNKNOWN_SERIAL';notes=notes||'Actual returned serial is not registered';}
    else if(line.expectedSerial && line.expectedSerial!==line.actualSerial){acceptance=line.itemCategory==='BAT'||line.itemCategory==='BATTERY'?'BATTERY_SWAP':'SERIAL_MISMATCH';}
    const lr=await run(c.env.DB,`INSERT INTO erp_return_lines(return_id,expected_asset_id,expected_serial,actual_asset_id,actual_serial,item_category,acceptance_status,condition_code,notes) VALUES(?,?,?,?,?,?,?,?,?)`,[returnId,expectedAsset?.id||null,line.expectedSerial||'',actualAsset?.id||null,line.actualSerial||'',line.itemCategory||actualAsset?.category||expectedAsset?.category||'',acceptance,line.conditionCode||'GOOD',notes]);
    let caseNo='';
    if(acceptance!=='MATCHED'){
      caseNo=await nextCode(c.env.DB,'RECON','REC',6);
      await run(c.env.DB,`INSERT INTO erp_reconciliation_cases(case_no,case_type,return_id,assignment_id,expected_serial,actual_serial,related_motorcycle_serial,current_location_code,status,opened_by) VALUES(?,?,?,?,?,?,?,?, 'UNRECONCILED',?)`,[caseNo,acceptance,returnId,assignmentId,line.expectedSerial||'',line.actualSerial||'',normalizeSerial(line.relatedMotorcycleSerial||''),loc.code,c.get('erpUser').email]);
    }
    results.push({returnLineId:lr.meta.last_row_id,expectedSerial:line.expectedSerial,actualSerial:line.actualSerial,acceptance,caseNo});
  }
  await run(c.env.DB,`INSERT INTO erp_document_flow_links(
    source_type,source_id,source_no,target_type,target_id,target_no,relation_type,created_by)
    VALUES('ASSIGNMENT',?,?, 'RETURN',?,?, 'RETURNED_BY',?)`,[
    assignmentId,assignment.assignment_no,returnId,no,c.get('erpUser').email,
  ]);
  await audit(c,{action:'CREATE_RETURN',module:'RETURNS',recordType:'RETURN',recordId:returnId,recordNo:no,after:{lines:results}});
  return ok(c,{returnId,returnNo:no,lines:results},201);
});

returnRoutes.post('/:id/post', requirePermission('RETURNS','POST'), async(c)=>{
  const id=Number(c.req.param('id')); const header=await first(c.env.DB,`SELECT r.*,l.code location_code,l.id location_id FROM erp_return_orders r LEFT JOIN erp_locations l ON l.id=r.return_location_id WHERE r.id=?`,[id]);
  if(!header)return fail(c,'Return not found',404); if(header.status==='POSTED')return fail(c,'Return already posted',409);
  const lines=await all(c.env.DB,`SELECT * FROM erp_return_lines WHERE return_id=?`,[id]); const posted=[];
  for(const line of lines){
    if(!line.actual_serial)continue;
    const asset=await getAsset(c.env.DB,line.actual_serial);
    if(!asset)continue;
    const unresolved=line.acceptance_status!=='MATCHED';
    try{
      const movement=await postMovement(c.env.DB,{
        serialNo:line.actual_serial,movementType:'RETURN',movementDate:header.return_date,toLocationId:header.location_id,toLocationCode:header.location_code,
        toStatus:unresolved?'QUARANTINE':'AVAILABLE',holderType:null,holderId:null,holderName:null,reasonCode:line.acceptance_status,notes:line.notes,
        conditionCode:line.condition_code,reconciliationStatus:unresolved?'UNRECONCILED':'CLEAR',sourceDocType:'RETURN',sourceDocId:id,sourceDocNo:header.return_no
      },c.get('erpUser').email);
      posted.push(movement);
    }catch(e){return fail(c,`Unable to post ${line.actual_serial}: ${e.message}`,409);}
  }
  await run(c.env.DB,`UPDATE erp_return_orders SET status='POSTED',posted_by=?,posted_at=datetime('now') WHERE id=?`,[c.get('erpUser').email,id]);
  if(header.assignment_id){
    const expected=(await first(c.env.DB,`SELECT COUNT(*) n FROM erp_assignment_assets WHERE assignment_id=?`,[header.assignment_id]))?.n||0;
    const returned=(await first(c.env.DB,`SELECT COUNT(DISTINCT rl.expected_serial) n
      FROM erp_return_lines rl JOIN erp_return_orders ro ON ro.id=rl.return_id
      WHERE ro.assignment_id=? AND ro.status='POSTED'`,[header.assignment_id]))?.n||0;
    await run(c.env.DB,`UPDATE erp_assignments SET status=?,actual_return_date=CASE WHEN ?>=?
      THEN ? ELSE actual_return_date END WHERE id=?`,[
      returned>=expected?'RETURNED':'PARTIALLY_RETURNED',returned,expected,header.return_date,header.assignment_id,
    ]);
    const assignment=await first(c.env.DB,`SELECT source_request_no FROM erp_assignments WHERE id=?`,[header.assignment_id]);
    if(assignment?.source_request_no){
      await run(c.env.DB,`UPDATE erp_requisition_allocations SET allocation_status='RETURNED',released_at=datetime('now')
        WHERE serial_no IN (SELECT actual_serial FROM erp_return_lines WHERE return_id=?)
          AND requisition_id=(SELECT id FROM erp_requisitions WHERE requisition_no=?)`,[
        id,assignment.source_request_no,
      ]);
    }
  }
  await audit(c,{action:'POST_RETURN',module:'RETURNS',recordType:'RETURN',recordId:id,recordNo:header.return_no,after:{posted}});
  return ok(c,{posted});
});

returnRoutes.get('/reconciliation/open', requirePermission('RETURNS','VIEW'), async(c)=>{
  const rows=await all(c.env.DB,`SELECT * FROM erp_reconciliation_cases WHERE status='UNRECONCILED' ORDER BY opened_at DESC`);
  return ok(c,{rows});
});

returnRoutes.post('/reconciliation/:id/resolve', requirePermission('RETURNS','APPROVE'), async(c)=>{
  const id=Number(c.req.param('id')); const b=await jsonBody(c); const before=await first(c.env.DB,`SELECT * FROM erp_reconciliation_cases WHERE id=?`,[id]);
  if(!before)return fail(c,'Reconciliation case not found',404); if(before.status!=='UNRECONCILED')return fail(c,'Case is already resolved',409);
  await run(c.env.DB,`UPDATE erp_reconciliation_cases SET status='RESOLVED',resolution_code=?,resolution_notes=?,resolved_by=?,resolved_at=datetime('now') WHERE id=?`,[b.resolutionCode||'VERIFIED',b.resolutionNotes||'',c.get('erpUser').email,id]);
  if(b.clearActualSerial && before.actual_serial)await run(c.env.DB,`UPDATE erp_assets SET reconciliation_status='CLEAR',current_status=CASE WHEN current_status='QUARANTINE' THEN 'AVAILABLE' ELSE current_status END,updated_at=datetime('now') WHERE serial_no=?`,[before.actual_serial]);
  const after=await first(c.env.DB,`SELECT * FROM erp_reconciliation_cases WHERE id=?`,[id]);
  await audit(c,{action:'RESOLVE_RECONCILIATION',module:'RETURNS',recordType:'RECONCILIATION',recordId:id,recordNo:after.case_no,before,after});
  return ok(c,{case:after});
});
