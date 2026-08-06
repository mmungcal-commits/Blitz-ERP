// Blitz - ERP  ·  outbound email + Google Drive file storage.
//
// TRANSPORTS (first configured one wins)
//   1. Resend        RESEND_API_KEY  (+ optional MAIL_FROM, default Blitz - ERP <erp@nrdev.ph>)
//   2. Apps Script   MAIL_WEBHOOK_URL + MAIL_WEBHOOK_SECRET   <- also required for Drive
//
// Google Drive uploads ALWAYS go through the Apps Script relay
// (scripts/E88_Mail_Relay.gs), because that is what owns the Drive folder.
// Set the secrets with:
//   npx wrangler secret put MAIL_WEBHOOK_URL
//   npx wrangler secret put MAIL_WEBHOOK_SECRET
//   npx wrangler secret put RESEND_API_KEY        (optional)
//
// Everything fails soft: if nothing is configured, workflow actions still
// succeed and the caller gets { ok:false, skipped:true }. Email must never
// block an approval.

const DEFAULT_FROM = 'Blitz - ERP <mmungcal@nrdev.ph>';
export const DRIVE_ROOT_FOLDER_ID = '1if_MxvG0z2LmlaPVX5uf5KMFp8jQGghZ';

function relayConfigured(env) {
  return Boolean(env && env.MAIL_WEBHOOK_URL && env.MAIL_WEBHOOK_SECRET);
}
function resendConfigured(env) {
  return Boolean(env && env.RESEND_API_KEY);
}

async function postRelay(env, payload) {
  const res = await fetch(env.MAIL_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ secret: env.MAIL_WEBHOOK_SECRET, ...payload }),
  });
  let data = {};
  try { data = await res.json(); } catch (_) { /* non-JSON */ }
  if (!res.ok || data.ok === false) {
    throw new Error((data && data.error) || `relay HTTP ${res.status}`);
  }
  return data;
}

function recipientList(value) {
  if (!value) return [];
  const list = Array.isArray(value) ? value : String(value).split(/[;,]/);
  return [...new Set(list.map(v => String(v || '').trim()).filter(Boolean))];
}

async function sendViaResend(env, message) {
  const body = {
    from: env.MAIL_FROM || DEFAULT_FROM,
    to: recipientList(message.to),
    subject: message.subject || '(no subject)',
    html: message.html || undefined,
    text: message.text || undefined,
  };
  const cc = recipientList(message.cc);
  const bcc = recipientList(message.bcc);
  if (cc.length) body.cc = cc;
  if (bcc.length) body.bcc = bcc;
  if (message.replyTo) body.reply_to = message.replyTo;
  if (message.attachments && message.attachments.length) {
    body.attachments = message.attachments.map(a => ({
      filename: a.filename || a.fileName || 'attachment',
      content: a.contentBase64 || a.data || '',
    }));
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || `Resend HTTP ${res.status}`);
  return { ok: true, id: data?.id, transport: 'resend' };
}

export async function sendMail(env, message) {
  if (!message || !recipientList(message.to).length) {
    return { ok: false, error: 'missing recipient' };
  }
  try {
    if (resendConfigured(env)) return await sendViaResend(env, message);
    if (relayConfigured(env)) {
      await postRelay(env, {
        action: 'send',
        to: recipientList(message.to).join(','),
        cc: recipientList(message.cc).join(',') || undefined,
        bcc: recipientList(message.bcc).join(',') || undefined,
        replyTo: message.replyTo,
        subject: message.subject || '(no subject)',
        html: message.html || '',
        text: message.text || '',
        fromName: message.fromName || 'Blitz - ERP',
        attachments: message.attachments || undefined,
      });
      return { ok: true, transport: 'apps-script' };
    }
    return { ok: false, skipped: true, reason: 'No mail transport configured (RESEND_API_KEY or MAIL_WEBHOOK_URL/SECRET)' };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}

// Send and never throw — for use inside workflow transitions.
export async function sendMailQuiet(env, message) {
  try { return await sendMail(env, message); }
  catch (err) { return { ok: false, error: String(err) }; }
}

/**
 * Upload a base64 file into Google Drive.
 * folder / subfolder are created under DRIVE_ROOT_FOLDER_ID on first use,
 * e.g. folder='Payables Management', subfolder='RFP-00000123'.
 */
export async function uploadFile(env, file) {
  if (!relayConfigured(env)) {
    return { ok: false, skipped: true, reason: 'Drive relay not configured. Set MAIL_WEBHOOK_URL and MAIL_WEBHOOK_SECRET.' };
  }
  const contentBase64 = file?.contentBase64 || file?.data;
  if (!contentBase64) return { ok: false, error: 'missing file contentBase64' };
  try {
    const data = await postRelay(env, {
      action: 'upload',
      filename: file.filename || file.fileName || `file-${Date.now()}`,
      mimeType: file.mimeType || file.contentType || 'application/octet-stream',
      contentBase64,
      folder: file.folder,
      subfolder: file.subfolder,
      share: file.share !== false,
    });
    return { ok: true, url: data.url, download: data.download, fileId: data.fileId, name: data.name, folderId: data.folderId };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}

export async function driveFolder(env, folder, subfolder) {
  if (!relayConfigured(env)) return { ok: false, skipped: true };
  try {
    const data = await postRelay(env, { action: 'folder', folder, subfolder });
    return { ok: true, folderId: data.folderId, url: data.url };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export function mailConfigured(env) {
  return resendConfigured(env) || relayConfigured(env);
}
export function driveConfigured(env) {
  return relayConfigured(env);
}
export function transportName(env) {
  if (resendConfigured(env)) return 'resend';
  if (relayConfigured(env)) return 'apps-script';
  return 'none';
}

// Shared, on-brand HTML wrapper so every notification looks consistent.
export function mailLayout(title, bodyHtml, footerNote) {
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;border:1px solid #d7e0e8;border-radius:8px;overflow:hidden">
    <div style="background:linear-gradient(135deg,#0a2239,#123a63);color:#fff;padding:16px 22px">
      <div style="font-size:19px;font-weight:800;letter-spacing:1.5px">BLITZ - ERP</div>
      <div style="font-size:12px;opacity:.82">E88 Ventures, Inc.</div>
    </div>
    <div style="padding:22px">
      <h2 style="margin:0 0 12px;font-size:18px;color:#0a2239">${esc(title)}</h2>
      ${bodyHtml}
    </div>
    <div style="padding:14px 22px;background:#f7f9fb;color:#657586;font-size:12px;border-top:1px solid #d7e0e8">
      ${esc(footerNote || 'Automated notification from Blitz - ERP. Please do not reply to this message.')}
      <br>E88 Ventures Inc. · 15 Brixton St., Kapitolyo, Pasig City 1603, Philippines
    </div>
  </div>`;
}

// A standard button used in approval emails.
export function mailButton(href, label) {
  return `<p style="margin:18px 0"><a href="${href}" style="display:inline-block;background:#123a63;color:#fff;text-decoration:none;padding:11px 20px;border-radius:6px;font-weight:700">${label}</a></p>`;
}

// Renders a simple label/value table for document summaries.
export function mailFacts(pairs) {
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const rows = (pairs || [])
    .filter(p => p && p[1] !== undefined && p[1] !== null && String(p[1]).trim() !== '')
    .map(p => `<tr><td style="padding:5px 10px 5px 0;color:#657586;font-size:12px;white-space:nowrap">${esc(p[0])}</td><td style="padding:5px 0;font-size:13px;font-weight:700;color:#17212b">${esc(p[1])}</td></tr>`)
    .join('');
  return `<table style="border-collapse:collapse;width:100%">${rows}</table>`;
}

// Renders the list of Drive links attached to a document.
export function mailAttachments(attachments) {
  if (!attachments || !attachments.length) return '';
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const items = attachments
    .filter(a => a && a.file_url)
    .map(a => `<li style="margin:3px 0"><a href="${esc(a.file_url)}" style="color:#1669a7">${esc(a.file_name)}</a></li>`)
    .join('');
  if (!items) return '';
  return `<p style="margin:16px 0 4px;font-size:13px;font-weight:700;color:#0a2239">Attached documents</p>
    <ul style="margin:0;padding-left:18px;font-size:13px">${items}</ul>`;
}
