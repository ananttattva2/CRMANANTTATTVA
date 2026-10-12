const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const express = require('express');

test('actual frontend → CRM upload routes → local S3 HTTP → preview/download round trip', async () => {
  const envNames = ['SPACES_ACCESS_KEY_ID', 'SPACES_SECRET_ACCESS_KEY', 'SPACES_LINK_SECRET', 'STORAGE_PUBLIC_API_ORIGIN', 'SPACES_ENDPOINT', 'SPACES_BUCKET', 'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'];
  const prior = envNames.map(key => process.env[key]); const objects = new Map(); const storageRequests = [];
  const authPath = require.resolve('../src/middleware/auth'); const previousAuth = require.cache[authPath];
  require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: {
    requireAuth: (req, res, next) => { if (req.headers.authorization !== 'Bearer fixture-user') return res.status(401).end(); req.user = { _id: 'fixture-user' }; next(); }
  } };
  const routePath = require.resolve('../src/routes/assets'); delete require.cache[routePath];
  const app = express(); app.use(express.json()); app.use('/api/assets', require(routePath));
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/ananttattva-crm-files/')) return app(req, res);
    const key = decodeURIComponent(url.pathname.slice('/ananttattva-crm-files/'.length));
    storageRequests.push({ method: req.method, key });
    if (req.method === 'PUT') {
      const chunks = []; for await (const chunk of req) chunks.push(chunk); const bytes = Buffer.concat(chunks);
      const checksum = crypto.createHash('sha256').update(bytes).digest('base64');
      if (req.headers['x-amz-checksum-sha256'] && checksum !== req.headers['x-amz-checksum-sha256']) { res.writeHead(400, { 'Content-Type': 'application/xml' }); return res.end('<Error><Code>BadDigest</Code></Error>'); }
      if (url.searchParams.has('X-Amz-SignedHeaders')) {
        const signed = url.searchParams.get('X-Amz-SignedHeaders').split(';');
        assert.ok(signed.every(header => req.headers[header]), 'All SigV4 signed headers reach the S3 HTTP endpoint');
      }
      objects.set(key, { bytes, type: req.headers['content-type'], disposition: req.headers['content-disposition'], sha256: url.searchParams.get('x-amz-meta-sha256') || req.headers['x-amz-meta-sha256'], runId: req.headers['x-amz-meta-migration-run'], sourceId: req.headers['x-amz-meta-source-id'] });
      res.writeHead(200, { ETag: '"fixture-etag"' }); return res.end();
    }
    const stored = objects.get(key);
    if (!stored) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': stored.type, 'Content-Length': stored.bytes.length, 'Content-Disposition': stored.disposition, 'x-amz-meta-sha256': stored.sha256, ...(stored.runId ? { 'x-amz-meta-migration-run': stored.runId, 'x-amz-meta-source-id': stored.sourceId } : {}), ETag: '"fixture-etag"' });
    res.end(req.method === 'HEAD' ? undefined : stored.bytes);
  });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    Object.assign(process.env, { SPACES_ACCESS_KEY_ID: 'fixture-key', SPACES_SECRET_ACCESS_KEY: 'fixture-secret', SPACES_LINK_SECRET: 'fixture-stable-secret-more-than-32-characters', STORAGE_PUBLIC_API_ORIGIN: origin, SPACES_ENDPOINT: origin, SPACES_BUCKET: 'ananttattva-crm-files' });
    const api = { post: async (endpoint, body) => {
      const response = await fetch(`${origin}/api${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fixture-user' }, body: JSON.stringify(body) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error); return { data };
    } };
    const code = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/services/mediaUpload.js'), 'utf8').replace(/^import api from '.\/api';\s*/m, '').replace(/export /g, '');
    const uploadMedia = new Function('api', 'fetch', `${code};return uploadMedia;`)(api, fetch);
    const bytes = Buffer.from('%PDF-1.4\nfixture invoice\n%%EOF');
    const file = new File([bytes], 'invoice.pdf', { type: 'application/pdf' });
    const saved = await uploadMedia(file, 'crm/proforma-invoices');
    assert.ok(saved.publicId.startsWith('spaces:crm/proforma-invoices/')); assert.equal(saved.size, bytes.length);
    assert.equal(objects.size, 1); assert.ok(storageRequests.some(r => r.method === 'PUT')); assert.ok(storageRequests.some(r => r.method === 'HEAD'));
    const preview = await fetch(saved.secureUrl); assert.equal(preview.status, 200); assert.equal(preview.headers.get('content-type'), 'application/pdf'); assert.equal(preview.headers.get('content-disposition'), 'inline');
    assert.deepEqual(Buffer.from(await preview.arrayBuffer()), bytes);
    const fallbackBody = new FormData(); fallbackBody.append('file', file); fallbackBody.append('folder', 'crm/invoices'); fallbackBody.append('checksum', crypto.createHash('sha256').update(bytes).digest('base64'));
    const fallback = await fetch(`${origin}/api/assets/upload`, { method: 'POST', headers: { Authorization: 'Bearer fixture-user' }, body: fallbackBody });
    assert.equal(fallback.status, 200); assert.ok((await fallback.json()).storageKey.startsWith('spaces:crm/invoices/'));
    const badLink = await fetch(saved.secureUrl.replace('signature=', 'signature=0')); assert.equal(badLink.status, 403);
    const anonymous = await fetch(`${origin}/api/assets/upload-url`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); assert.equal(anonymous.status, 401);
    const invalid = await fetch(`${origin}/api/assets/upload-confirm`, { method: 'POST', headers: { Authorization: 'Bearer fixture-user', 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'forged' }) }); assert.equal(invalid.status, 400);
    // Exercise the real streamed migration transfer against the same local S3 HTTP service.
    const { transfer, verifyTarget } = require('../src/scripts/migrateCloudinaryToSpaces');
    const originalFetch = global.fetch; const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-transfer-test-'));
    Object.assign(process.env, { CLOUDINARY_CLOUD_NAME: 'fixture-cloud', CLOUDINARY_API_KEY: 'fixture-key', CLOUDINARY_API_SECRET: 'fixture-secret' });
    global.fetch = async (input, options) => new URL(input).hostname === 'api.cloudinary.com' ? new Response(bytes, { headers: { 'Content-Length': String(bytes.length), 'Content-Type': 'application/pdf' } }) : originalFetch(input, options);
    try {
      const asset = { id: 'fixture-asset', kind: 'original', key: 'crm/invoices/old.pdf', bytes: bytes.length };
      const verification = await transfer(asset, { runId: 'fixture-run' }, directory);
      assert.equal(verification.size, bytes.length); assert.equal(verification.sha256, crypto.createHash('sha256').update(bytes).digest('hex'));
      asset.verification = verification; await verifyTarget(asset);
      const puts = storageRequests.filter(r => r.method === 'PUT').length;
      await transfer(asset, { runId: 'fixture-run' }, directory); assert.equal(storageRequests.filter(r => r.method === 'PUT').length, puts, 'Retry reuses an identical destination without overwriting');
      objects.get(asset.key).bytes = Buffer.from('corrupt'); await assert.rejects(verifyTarget(asset), /verification failed/);
      await transfer(asset, { runId: 'fixture-run' }, directory); await verifyTarget(asset);
      objects.set('crm/invoices/conflict.pdf', { ...objects.get(asset.key), bytes: Buffer.from('unrelated existing object'), runId: 'other-run' });
      await assert.rejects(transfer({ ...asset, key: 'crm/invoices/conflict.pdf' }, { runId: 'fixture-run' }, directory), error => error.safeMessage.includes('no overwrite'));
      assert.equal(objects.get('crm/invoices/conflict.pdf').bytes.toString(), 'unrelated existing object');
      assert.equal(fs.readdirSync(directory).length, 0, 'Local download files are cleaned after both success and failure');
    } finally { global.fetch = originalFetch; fs.rmdirSync(directory); }
  } finally {
    envNames.forEach((key, i) => prior[i] === undefined ? delete process.env[key] : process.env[key] = prior[i]);
    if (previousAuth) require.cache[authPath] = previousAuth; else delete require.cache[authPath];
    delete require.cache[routePath];
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
});
