const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { S3Client } = require('@aws-sdk/client-s3');
const storage = require('../src/services/spacesStorage');
const { resolvePoProof } = require('../src/services/poProofResolver');

test('private storage, browser upload confirmation, stable preview links and attachment cleanup', async () => {
  const keys = ['SPACES_ACCESS_KEY_ID', 'SPACES_SECRET_ACCESS_KEY', 'SPACES_LINK_SECRET', 'STORAGE_PUBLIC_API_ORIGIN'];
  const previous = keys.map(key => process.env[key]);
  Object.assign(process.env, { SPACES_ACCESS_KEY_ID: 'test-key', SPACES_SECRET_ACCESS_KEY: 'test-secret', SPACES_LINK_SECRET: 'test-link-secret-at-least-32-characters', STORAGE_PUBLIC_API_ORIGIN: 'https://crm.example.test' });
  const checksum = crypto.createHash('sha256').update('png').digest('base64');
  const originalSend = S3Client.prototype.send; const calls = []; let metadata = { ContentLength: 3, ContentType: 'image/png', Metadata: { sha256: Buffer.from(checksum, 'base64').toString('hex') } };
  S3Client.prototype.send = async function(command) { calls.push(command); return metadata; };
  try {
    const image = await storage.uploadBuffer(Buffer.from('png'), 'photo.png', 'image/png', 'crm/client-master');
    assert.equal(calls[0].input.ACL, 'private'); assert.equal(calls[0].input.ContentDisposition, 'inline'); assert.equal(calls[0].input.ContentLength, 3);
    assert.ok(image.key.startsWith('crm/client-master/')); assert.ok(image.storageKey.startsWith('spaces:crm/'));
    assert.ok(storage.managedUrl(image.url)); assert.ok(!storage.managedUrl(image.url.replace('crm.example.test', 'evil.test')));
    assert.ok(!storage.managedUrl(image.url.replace('signature=', 'signature=0')));
    const resolved = resolvePoProof({ arbitrary: { nested: { other: image.url } } }); assert.equal(resolved.url, image.url);
    const download = new URL(await storage.downloadUrl(image.storageKey)); assert.equal(download.hostname, 'ananttattva-crm-files.sgp1.digitaloceanspaces.com'); assert.equal(download.searchParams.get('X-Amz-Expires'), '60');
    const authorization = await storage.authorizeUpload({ name: 'photo.png', type: 'image/png', size: 3, folder: 'crm/notifications', checksum }, 'user-1');
    const corsCommand = calls.find(command => command.constructor.name === 'PutBucketCorsCommand');
    const uploadRule = corsCommand.input.CORSConfiguration.CORSRules.find(rule => rule.ID === 'ananttattva-crm-browser-uploads');
    assert.ok(uploadRule.AllowedOrigins.includes('https://crm.example.test'));
    assert.deepEqual(uploadRule.AllowedMethods, ['PUT', 'GET', 'HEAD']);
    assert.deepEqual(uploadRule.AllowedHeaders, ['*']);
    assert.equal(new URL(authorization.uploadUrl).hostname, 'ananttattva-crm-files.sgp1.digitaloceanspaces.com');
    const signedHeaders = new URL(authorization.uploadUrl).searchParams.get('X-Amz-SignedHeaders').split(';').filter(header => header !== 'host');
    assert.ok(signedHeaders.every(header => Object.keys(authorization.headers).some(actual => actual.toLowerCase() === header)), 'Browser receives every signed request header');
    const confirmed = await storage.confirmUpload(authorization.token, 'user-1'); assert.equal(confirmed.name, 'photo.png'); assert.equal(confirmed.type, 'image/png');
    await assert.rejects(storage.confirmUpload(authorization.token, 'other-user'), /unauthorized/);
    await assert.rejects(storage.confirmUpload(`${authorization.token}0`, 'user-1'), /Invalid/);
    metadata = { ContentLength: 2, ContentType: 'image/png' };
    await assert.rejects(storage.confirmUpload(authorization.token, 'user-1'), /does not match/);
    await assert.rejects(storage.authorizeUpload({ name: 'large', type: '', size: 26 * 1024 * 1024 }, 'user-1'), /size limit/);
    await storage.uploadBuffer(Buffer.from('<script>'), 'bad.html', 'text/html', 'crm/uploads'); assert.equal(calls.at(-1).input.ContentDisposition, 'attachment');
    const emails = require('../src/services/purchaseEmailProofService');
    const email = await emails.uploadBuffer(Buffer.from('EML'), 'proof.eml', 'message/rfc822', 'crm/purchase-email-proofs/originals'); assert.ok(email.storageKey.startsWith('spaces:crm/purchase-email-proofs/'));
    const beforeCleanup = calls.length; await emails.deleteStored('crm/legacy-cloudinary-id'); assert.equal(calls.length, beforeCleanup);
    await emails.deleteStored(email.storageKey); assert.equal(calls.at(-1).input.Key, email.key);
    delete process.env.SPACES_ACCESS_KEY_ID;
    await assert.rejects(storage.uploadBuffer(Buffer.from('file'), 'file', '', 'crm/uploads'), /not configured/);
  } finally {
    S3Client.prototype.send = originalSend;
    keys.forEach((key, i) => previous[i] === undefined ? delete process.env[key] : process.env[key] = previous[i]);
  }
});
test('actual frontend media helper uploads directly with PUT then saves only confirmed metadata', async () => {
  const code = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/services/mediaUpload.js'), 'utf8').replace(/^import api from '.\/api';\s*/m, '').replace(/export /g, '');
  const calls = []; const verified = { url: 'verified-url', secureUrl: 'verified-url', publicId: 'spaces:crm/file' };
  const headers = { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline', 'x-amz-checksum-sha256': 'checksum' };
  const api = { post: async (endpoint, payload) => { calls.push({ endpoint, payload }); return { data: endpoint.endsWith('upload-url') ? { uploadUrl: 'https://bucket.sgp1.digitaloceanspaces.com/crm/file', token: 'receipt', headers } : verified }; } };
  const fetch = async (url, options) => { calls.push({ url, options }); return { ok: true }; };
  const { uploadMedia, mediaUrl } = new Function('api', 'fetch', `${code};return {uploadMedia,mediaUrl};`)(api, fetch);
  const file = { name: 'invoice.pdf', type: 'application/pdf', size: 123, arrayBuffer: async () => Buffer.alloc(123) };
  assert.equal(await uploadMedia(file, 'crm/proforma-invoices'), verified);
  assert.equal(calls[0].endpoint, '/assets/upload-url'); assert.equal(calls[1].options.method, 'PUT'); assert.equal(calls[1].options.body, file);
  assert.equal(calls[1].options.headers, headers); assert.equal(calls[0].payload.checksum, crypto.createHash('sha256').update(Buffer.alloc(123)).digest('base64'));
  assert.equal(calls[2].endpoint, '/assets/upload-confirm'); assert.equal(mediaUrl(verified), 'verified-url');
  calls.length = 0;
  const failed = new Function('api', 'fetch', `${code};return uploadMedia;`)(api, async () => ({ ok: false }));
  await assert.rejects(failed(file), /upload failed/); assert.equal(calls.length, 1, 'Failed transfers never call confirmation');
});
