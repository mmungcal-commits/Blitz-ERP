import { run } from './db.js';
import { requestMeta } from './http.js';

export async function audit(c, event) {
  const user = c.get('erpUser');
  const meta = requestMeta(c);
  await run(c.env.DB,
    `INSERT INTO erp_audit_log(user_email,environment,action,module,record_type,record_id,record_no,before_json,after_json,request_id,ip_address,user_agent)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    [user?.email || '', c.env.ENVIRONMENT || 'LIVE', event.action, event.module,
     event.recordType || '', event.recordId || null, event.recordNo || '',
     event.before ? JSON.stringify(event.before) : null, event.after ? JSON.stringify(event.after) : null,
     meta.requestId, meta.ipAddress, meta.userAgent]);
}
