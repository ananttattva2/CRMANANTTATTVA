const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('browser sanitizer removes EML attachment payload and retains the email body', async () => {
  const { stripEmlAttachments } = await import('../../frontend/src/features/clientMaster/emailProofSanitizer.mjs');
  const raw = `From: sender@example.com\r\nTo: crm@example.com\r\nSubject: Proof\r\nDate: Tue, 27 Oct 2026 10:00:00 +0530\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="proof-boundary"\r\n\r\n--proof-boundary\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nThis is the required mail body.\r\n--proof-boundary\r\nContent-Type: application/pdf; name="huge.pdf"\r\nContent-Disposition: attachment; filename="huge.pdf"\r\nContent-Transfer-Encoding: base64\r\n\r\nVERY_LARGE_ATTACHMENT_PAYLOAD\r\n--proof-boundary--`;
  const sanitized = stripEmlAttachments(raw);
  assert.match(sanitized, /This is the required mail body/);
  assert.match(sanitized, /X-CRM-Attachments-Removed: true/);
  assert.doesNotMatch(sanitized, /huge\.pdf|VERY_LARGE_ATTACHMENT_PAYLOAD/);
});

test('both Purchase and Sales uploads sanitize email files before creating multipart data', () => {
  const purchase = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/features/clientMaster/PurchaseDataWorkspace.jsx'), 'utf8');
  const sales = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/features/clientMaster/SalesDataPanel.jsx'), 'utf8');
  for (const source of [purchase, sales]) {
    assert.match(source, /emailProofWithoutAttachments\(emailFile\)/);
    assert.match(source, /form\.append\('file', mailOnlyFile\)/);
  }
});
