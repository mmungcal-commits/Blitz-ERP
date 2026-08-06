import { Hono } from 'hono';
import { ok, fail } from '../lib/http.js';
import { sendMail, uploadFile, mailConfigured, driveConfigured, transportName, mailLayout, driveFolder } from '../lib/mailer.js';
import { all } from '../lib/db.js';

export const mailRoutes = new Hono();

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Is the email/Drive relay configured? (drives the UI hint + self-test button state)
mailRoutes.get('/status', c => ok(c, {
  configured: mailConfigured(c.env),
  mail: mailConfigured(c.env),
  drive: driveConfigured(c.env),
  transport: transportName(c.env),
}));

// Confirm the Drive folder tree is reachable and create a module folder on demand.
mailRoutes.post('/drive-check', async c => {
  const body = await c.req.json().catch(() => ({}));
  if (!driveConfigured(c.env)) {
    return fail(c, 'Drive relay not configured. Deploy scripts/E88_Mail_Relay.gs and set MAIL_WEBHOOK_URL / MAIL_WEBHOOK_SECRET.', 503);
  }
  const result = await driveFolder(c.env, body.folder || 'Relay Self Test', body.subfolder);
  if (!result.ok) return fail(c, result.error || 'Drive check failed.', 502);
  return ok(c, result);
});

// Files that could not reach Drive (relay offline when they were uploaded).
mailRoutes.get('/pending-uploads', async c => {
  const rows = await all(c.env.DB,
    `SELECT id,module_code,record_type,record_no,file_name,uploaded_by,uploaded_at
       FROM erp_attachments WHERE storage='PENDING' AND active=1 ORDER BY id DESC LIMIT 200`);
  return ok(c, { rows, count: rows.length });
});

// Send a self-test email to the current user (or a supplied address).
mailRoutes.post('/selftest', async c => {
  const user = c.get('erpUser') || {};
  const body = await c.req.json().catch(() => ({}));
  const to = body.to || user.email;
  if (!to) return fail(c, 'No recipient email available.', 400);
  if (!mailConfigured(c.env)) {
    return fail(c, 'Email relay not configured. Set MAIL_WEBHOOK_URL and MAIL_WEBHOOK_SECRET.', 503);
  }
  const html = mailLayout(
    'Email self-test',
    `<p>This is a test message from <b>Blitz - ERP</b>.</p>
     <p>If you are reading this, outbound email is working. RFP notifications, purchase-order
     approval links and payment instructions can now be delivered.</p>
     <p>Transport in use: <b>${esc(transportName(c.env))}</b> · Google Drive: <b>${driveConfigured(c.env) ? 'connected' : 'not configured'}</b></p>
     <p style="color:#657586;font-size:12px;margin-top:16px">Triggered by ${esc(user.email || 'unknown')} · ${new Date().toISOString()}</p>`,
    'Automated self-test from Blitz - ERP.'
  );
  const result = await sendMail(c.env, {
    to,
    subject: 'Blitz - ERP email self-test',
    html,
  });
  if (!result.ok) return fail(c, result.error || 'Send failed.', 502);
  return ok(c, { sent: true, to });
});

// Generic Drive upload passthrough (used by the proof-of-payment step).
// Body: { filename, mimeType, contentBase64, subfolder }
mailRoutes.post('/upload', async c => {
  if (!mailConfigured(c.env)) {
    return fail(c, 'File relay not configured. Set MAIL_WEBHOOK_URL and MAIL_WEBHOOK_SECRET.', 503);
  }
  const body = await c.req.json().catch(() => ({}));
  if (!body.contentBase64) return fail(c, 'No file provided.', 400);
  const result = await uploadFile(c.env, {
    filename: body.filename,
    mimeType: body.mimeType,
    contentBase64: body.contentBase64,
    subfolder: body.subfolder,
    share: body.share,
  });
  if (!result.ok) return fail(c, result.error || 'Upload failed.', 502);
  return ok(c, { url: result.url, fileId: result.fileId, name: result.name });
});
