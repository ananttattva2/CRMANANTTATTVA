const test = require('node:test');
const assert = require('node:assert/strict');
const { decodeEmail } = require('../src/services/purchaseEmailProofService');

test('Outlook fromhtml RTF extraction retains table tags and visible cell text', async () => {
  const { extractHtmlFromRtf } = await import('../../frontend/src/features/clientMaster/emailProofSanitizer.mjs');
  const rtf = String.raw`{\rtf1{\*\htmltag19 <html>}{\*\htmltag34 <body>}{\*\htmltag64 <table>}{\*\htmltag64 <tr>}{\*\htmltag148 <td rowspan="2">}\htmlrtf \b \htmlrtf0 Category of Plastic{\*\htmltag248 </td>}\htmlrtf \par\htmlrtf0{\*\htmltag72 </tr>}{\*\htmltag72 </table>}{\*\htmltag40 </body>}{\*\htmltag27 </html>}}`;
  const html = extractHtmlFromRtf(rtf);
  assert.match(html, /<table>/);
  assert.match(html, /<td rowspan="2">Category of Plastic<\/td>/);
});

test('email sanitizer preserves safe table spans and removes active content', async () => {
  const source = [
    'From: Test <test@example.com>',
    'To: Reviewer <reviewer@example.com>',
    'Subject: Table proof',
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
    '',
    '<table><tr><th rowspan="2" onclick="alert(1)">Importer</th><th colspan="2">Total Sales</th></tr><tr><td>Cat-II</td><td>0.021</td></tr></table><script>alert(1)</script><img src="https://tracker.invalid/pixel">'
  ].join('\r\n');
  const result = await decodeEmail({ buffer: Buffer.from(source), size: Buffer.byteLength(source), originalname: 'proof.eml', mimetype: 'message/rfc822' }, 'eml');
  assert.match(result.sanitizedHtmlBody, /rowspan="2"/);
  assert.match(result.sanitizedHtmlBody, /colspan="2"/);
  assert.doesNotMatch(result.sanitizedHtmlBody, /onclick|<script|<img/i);
});
