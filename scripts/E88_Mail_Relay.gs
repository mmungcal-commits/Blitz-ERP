/**
 * Blitz - ERP  ·  Mail + Google Drive relay
 * ---------------------------------------------------------------------------
 * Deploy this as a Google Apps Script Web App under mmungcal@nrdev.ph.
 * It gives the Cloudflare Worker two things it cannot do on its own:
 *
 *   1. Send email AS mmungcal@nrdev.ph (no Resend/SendGrid account, no domain
 *      verification, no DNS records — Gmail is already authenticated).
 *   2. Write uploaded files into the Google Drive folder tree, creating a
 *      subfolder per module and per document automatically.
 *
 * ---------------------------------------------------------------------------
 * SETUP (about 10 minutes, once)
 * ---------------------------------------------------------------------------
 * 1.  Sign in to Google as mmungcal@nrdev.ph.
 * 2.  Go to https://script.google.com  ->  New project.
 * 3.  Name it "Blitz ERP Relay". Delete the sample code, paste this file.
 * 4.  Change SHARED_SECRET below to a long random string. Keep it — you will
 *     paste the same value into Cloudflare as MAIL_WEBHOOK_SECRET.
 * 5.  Confirm ROOT_FOLDER_ID matches the Drive folder you want everything in.
 * 6.  Deploy -> New deployment -> type "Web app".
 *        Description : Blitz ERP relay
 *        Execute as  : Me (mmungcal@nrdev.ph)
 *        Who has access : Anyone            <-- required; the secret is the guard
 *     Click Deploy, then Authorize access and accept the Gmail + Drive scopes.
 *     ("Anyone" only means Google will not demand a Google login; every request
 *     is still rejected unless it carries the shared secret.)
 * 7.  Copy the Web app URL. It ends in /exec.
 * 8.  In Cloudflare -> Workers & Pages -> e88-finsys -> Settings -> Variables,
 *     add two SECRETS (not plain text vars):
 *        MAIL_WEBHOOK_URL     = the /exec URL from step 7
 *        MAIL_WEBHOOK_SECRET  = the SHARED_SECRET from step 4
 *     Or from a terminal:
 *        npx wrangler secret put MAIL_WEBHOOK_URL
 *        npx wrangler secret put MAIL_WEBHOOK_SECRET
 * 9.  Redeploy the Worker, then in the ERP open any module and call
 *     POST /api/mail/selftest — you should receive a test email.
 *
 * ---------------------------------------------------------------------------
 * WHENEVER YOU EDIT THIS FILE: Deploy -> Manage deployments -> edit (pencil)
 * -> Version: New version -> Deploy. The /exec URL stays the same.
 * ---------------------------------------------------------------------------
 */

// ===== CONFIGURE THESE TWO =================================================
var SHARED_SECRET  = 'CHANGE-ME-to-a-long-random-string';
var ROOT_FOLDER_ID = '1if_MxvG0z2LmlaPVX5uf5KMFp8jQGghZ';
// ===========================================================================

var FROM_NAME      = 'Blitz - ERP';
var DAILY_MAIL_CAP = 1400; // Workspace accounts are limited to ~1500/day

function doPost(e) {
  var body = {};
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return _json({ ok: false, error: 'Invalid JSON body' });
  }
  if (!SHARED_SECRET || body.secret !== SHARED_SECRET) {
    return _json({ ok: false, error: 'Unauthorized' });
  }
  try {
    var action = String(body.action || 'send').toLowerCase();
    if (action === 'upload') return _json(_upload(body));
    if (action === 'folder') return _json(_folderInfo(body));
    if (action === 'ping')   return _json({ ok: true, pong: true, quota: MailApp.getRemainingDailyQuota() });
    return _json(_send(body));
  } catch (err) {
    return _json({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function doGet() {
  return _json({ ok: true, service: 'Blitz - ERP relay', ready: true });
}

/* ------------------------------------------------------------------ email */
function _send(body) {
  if (!body.to) return { ok: false, error: 'missing recipient' };
  var remaining = MailApp.getRemainingDailyQuota();
  if (remaining <= (1500 - DAILY_MAIL_CAP)) {
    return { ok: false, error: 'Daily Gmail quota nearly exhausted (' + remaining + ' left)' };
  }
  var options = {
    name: body.fromName || FROM_NAME,
    htmlBody: body.html || undefined,
    replyTo: body.replyTo || undefined
  };
  if (body.cc)  options.cc  = body.cc;
  if (body.bcc) options.bcc = body.bcc;

  // Attachments arrive as [{ filename, mimeType, contentBase64 }]
  if (body.attachments && body.attachments.length) {
    options.attachments = body.attachments.map(function (a) {
      return Utilities.newBlob(
        Utilities.base64Decode(a.contentBase64 || a.data || ''),
        a.mimeType || a.contentType || 'application/octet-stream',
        a.filename || a.fileName || 'attachment'
      );
    });
  }
  GmailApp.sendEmail(
    body.to,
    body.subject || '(no subject)',
    body.text || _stripHtml(body.html || ''),
    options
  );
  return { ok: true, sent: true, quotaLeft: MailApp.getRemainingDailyQuota() };
}

/* ------------------------------------------------------------------ drive */
function _upload(body) {
  if (!body.contentBase64) return { ok: false, error: 'missing file contentBase64' };
  var folder = _resolveFolder(body.folder, body.subfolder);
  var blob = Utilities.newBlob(
    Utilities.base64Decode(body.contentBase64),
    body.mimeType || 'application/octet-stream',
    body.filename || ('file-' + new Date().getTime())
  );
  var file = folder.createFile(blob);
  if (body.share !== false) {
    // Anyone with the link can view. The ERP stores this URL on the record.
    try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
  }
  return {
    ok: true,
    fileId: file.getId(),
    name: file.getName(),
    url: file.getUrl(),
    download: 'https://drive.google.com/uc?export=download&id=' + file.getId(),
    folderId: folder.getId(),
    folderPath: body.folder ? (body.folder + (body.subfolder ? '/' + body.subfolder : '')) : ''
  };
}

function _folderInfo(body) {
  var folder = _resolveFolder(body.folder, body.subfolder);
  return { ok: true, folderId: folder.getId(), name: folder.getName(), url: folder.getUrl() };
}

/**
 * Resolves ROOT / <module> / <subfolder>, creating the folders on first use.
 * The ERP sends folder='Payables Management', subfolder='RFP-00000123'.
 */
function _resolveFolder(moduleName, subName) {
  var current = DriveApp.getFolderById(ROOT_FOLDER_ID);
  [moduleName, subName].forEach(function (name) {
    var clean = _safeName(name);
    if (!clean) return;
    var found = current.getFoldersByName(clean);
    current = found.hasNext() ? found.next() : current.createFolder(clean);
  });
  return current;
}

function _safeName(name) {
  return String(name == null ? '' : name).replace(/[\\/:*?"<>|]/g, '-').trim().slice(0, 120);
}

function _stripHtml(html) {
  return String(html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
}

function _json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* --------------------------------------------------------------- self test
 * Run this once from the Apps Script editor (Run -> testRelay) to trigger the
 * Gmail + Drive authorisation prompt before the Worker ever calls it.
 */
function testRelay() {
  var folder = _resolveFolder('Relay Self Test', null);
  Logger.log('Folder ready: ' + folder.getUrl());
  GmailApp.sendEmail('mmungcal@nrdev.ph', 'Blitz - ERP relay is live',
    'The Apps Script relay authorised successfully. Drive folder: ' + folder.getUrl(),
    { name: FROM_NAME });
  Logger.log('Test email sent. Remaining quota: ' + MailApp.getRemainingDailyQuota());
}
