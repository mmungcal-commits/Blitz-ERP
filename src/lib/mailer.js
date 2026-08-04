// E88 Enterprise System — outbound email via the Google Apps Script relay.
//
// Worker secrets (set with `wrangler secret put` or the Cloudflare dashboard):
//   MAIL_WEBHOOK_URL     the Apps Script Web App /exec URL
//   MAIL_WEBHOOK_SECRET  shared secret, must equal SHARED_SECRET in E88_Mail_Relay.gs
//
// Fails soft: if the relay isn't configured or errors, workflow actions still
// succeed — email is best-effort and never blocks an approval/payment step.

export async function sendMail(env, message) {
  const url = env && env.MAIL_WEBHOOK_URL;
  const secret = env && env.MAIL_WEBHOOK_SECRET;
  if (!url || !secret) {
    return { ok: false, skipped: true, reason: 'MAIL_WEBHOOK_URL / MAIL_WEBHOOK_SECRET not configured' };
  }
  if (!message || !message.to) {
    return { ok: false, error: 'missing recipient' };
  }
  const payload = {
    secret,
    to: message.to,
    cc: message.cc,
    bcc: message.bcc,
    replyTo: message.replyTo,
    subject: message.subject || '(no subject)',
    html: message.html || '',
    text: message.text || '',
    fromName: message.fromName || 'E88 Enterprise System',
    attachments: message.attachments || undefined,
  };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    let data = {};
    try { data = await res.json(); } catch (_) { /* non-JSON response */ }
    if (!res.ok || data.ok === false) {
      return { ok: false, error: (data && data.error) || `relay HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// Upload a file (base64) to Google Drive through the same relay.
// Returns { ok, url, fileId, name } on success — store `url` on the record.
export async function uploadFile(env, file) {
  const url = env && env.MAIL_WEBHOOK_URL;
  const secret = env && env.MAIL_WEBHOOK_SECRET;
  if (!url || !secret) {
    return { ok: false, skipped: true, reason: 'MAIL_WEBHOOK_URL / MAIL_WEBHOOK_SECRET not configured' };
  }
  if (!file || !file.contentBase64) {
    return { ok: false, error: 'missing file contentBase64' };
  }
  const payload = {
    secret,
    action: 'upload',
    filename: file.filename || `proof-${Date.now()}`,
    mimeType: file.mimeType || 'application/octet-stream',
    contentBase64: file.contentBase64,
    folder: file.folder,
    subfolder: file.subfolder,
    share: file.share,
  };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    let data = {};
    try { data = await res.json(); } catch (_) {}
    if (!res.ok || data.ok === false) {
      return { ok: false, error: (data && data.error) || `relay HTTP ${res.status}` };
    }
    return { ok: true, url: data.url, fileId: data.fileId, name: data.name };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// Whether email + file relay is configured (for the self-test endpoint / UI hints).
export function mailConfigured(env) {
  return Boolean(env && env.MAIL_WEBHOOK_URL && env.MAIL_WEBHOOK_SECRET);
}

// Shared, on-brand HTML wrapper so every notification looks consistent.
export function mailLayout(title, bodyHtml, footerNote) {
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;border:1px solid #d7e0e8;border-radius:8px;overflow:hidden">
    <div style="background:#0a2239;color:#fff;padding:16px 22px">
      <div style="font-size:18px;font-weight:700">E88 Ventures, Inc.</div>
      <div style="font-size:12px;opacity:.8">Enterprise System</div>
    </div>
    <div style="padding:22px">
      <h2 style="margin:0 0 12px;font-size:18px;color:#0a2239">${esc(title)}</h2>
      ${bodyHtml}
    </div>
    <div style="padding:14px 22px;background:#f7f9fb;color:#657586;font-size:12px;border-top:1px solid #d7e0e8">
      ${esc(footerNote || 'This is an automated notification from the E88 Enterprise System.')}
      <br>E88 Ventures Inc. · 15 Brixton St., Kapitolyo, Pasig City 1603, Philippines
    </div>
  </div>`;
}
