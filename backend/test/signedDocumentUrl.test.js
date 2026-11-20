const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const source = fs.readFileSync(path.resolve(__dirname,'../../frontend/src/features/clientMaster/ClientMasterAnnualReturn.jsx'),'utf8');
const helper = source.slice(source.indexOf('export function normalizeDocumentUrl'),source.indexOf('export function safeDecode')).replace('export ','');
const normalize = new Function(helper+';return normalizeDocumentUrl;')();
test('View PO preserves signed object keys and signatures without double encoding',()=>{
 const secret='test-only-signing-key';
 for(const key of ['crm/leads/purchase-orders/order.pdf','crm/leads/purchase-orders/PO 100% + #1.pdf']) {
  const signature=crypto.createHmac('sha256',secret).update('file:'+key).digest('hex');
  const url='https://example.test/api/assets/file?key='+encodeURIComponent(key)+'&signature='+signature;
  assert.equal(normalize(url),url);
  const parsed=new URL(normalize(url));
  assert.equal(parsed.searchParams.get('key'),key);
  assert.equal(crypto.createHmac('sha256',secret).update('file:'+parsed.searchParams.get('key')).digest('hex'),parsed.searchParams.get('signature'));
  const relative=parsed.pathname+parsed.search;assert.equal(normalize(relative),relative);
 }
});
test('external document links retain encoded paths and legacy object keys remain supported',()=>{
 assert.equal(normalize('https://example.test/a%20b.pdf?token=a%2Bb'),'https://example.test/a%20b.pdf?token=a%2Bb');
 assert.equal(normalize('legacy/file.pdf'),'https://ananttattva-s3-bucket.s3.ap-south-1.amazonaws.com/legacy%2Ffile.pdf');
 assert.equal(normalize(''),'#');
});
