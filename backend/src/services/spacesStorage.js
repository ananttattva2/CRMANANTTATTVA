const crypto = require('node:crypto');
const { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand, GetBucketCorsCommand, PutBucketCorsCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
let cachedClient;
let cachedCredentials;
let uploadCorsPromise;
let uploadCorsIdentity;

function config() {
  const secret = process.env.SPACES_LINK_SECRET;
  const origin = String(process.env.STORAGE_PUBLIC_API_ORIGIN || '').replace(/\/+$/, '');
  if (!process.env.SPACES_ACCESS_KEY_ID || !process.env.SPACES_SECRET_ACCESS_KEY || !secret || secret.length < 32 || !origin) throw new Error('Spaces storage is not configured.');
  const identity = JSON.stringify([process.env.SPACES_ENDPOINT, process.env.SPACES_REGION, process.env.SPACES_ACCESS_KEY_ID, process.env.SPACES_SECRET_ACCESS_KEY]);
  if (!cachedClient || identity !== cachedCredentials) {
    if (cachedClient) cachedClient.destroy();
    cachedClient = new S3Client({
    endpoint: process.env.SPACES_ENDPOINT || 'https://sgp1.digitaloceanspaces.com', region: process.env.SPACES_REGION || 'sgp1',
    requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
    credentials: { accessKeyId: process.env.SPACES_ACCESS_KEY_ID, secretAccessKey: process.env.SPACES_SECRET_ACCESS_KEY }
    }); cachedCredentials = identity;
  }
  return { secret, origin, bucket: process.env.SPACES_BUCKET || 'ananttattva-crm-files', client: cachedClient };
}
function sign(value) { return crypto.createHmac('sha256', config().secret).update(value).digest('hex'); }
function equalSignature(value, supplied) { return /^[a-f0-9]{64}$/.test(supplied || '') && crypto.timingSafeEqual(Buffer.from(sign(value)), Buffer.from(supplied)); }
function validKey(key) { return typeof key === 'string' && key.length > 0 && Buffer.byteLength(key) <= 1024 && !key.startsWith('/') && !key.split('/').some(part => part === '.' || part === '..') && !/[\x00-\x1f\x7f]/.test(key); }
function rawKey(value) { return value.startsWith('spaces:') ? value.slice(7) : value; }
function fileUrl(key) { if (!validKey(key)) throw new Error('Invalid object key.'); return `${config().origin}/api/assets/file?key=${encodeURIComponent(key)}&signature=${sign(`file:${key}`)}`; }
function validLink(key, signature) { return validKey(key) && equalSignature(`file:${key}`, signature); }
function managedUrl(value) { try { const url = new URL(value); return url.origin === new URL(config().origin).origin && url.pathname === '/api/assets/file' && validLink(url.searchParams.get('key'), url.searchParams.get('signature')); } catch { return false; } }
function disposition(type) { return /^(image\/(png|jpeg|gif|webp)|application\/pdf)$/.test(type || '') ? 'inline' : 'attachment'; }
function objectResult(key, size) { return { provider: 'spaces', key, storageKey: `spaces:${key}`, publicId: `spaces:${key}`, storageUrl: fileUrl(key), url: fileUrl(key), secureUrl: fileUrl(key), size, bytes: size }; }
function uploadKey(folder, name) {
  const prefix = String(folder || 'crm/uploads').replace(/[^a-zA-Z0-9/_-]/g, '-').replace(/^\/+|\/+$/g, '').slice(0, 120);
  if (!prefix.startsWith('crm/')) throw new Error('Invalid upload folder.');
  return `${prefix}/${crypto.randomUUID()}-${String(name || 'file').replace(/[^a-zA-Z0-9._-]/g, '-').slice(-180)}`;
}
function browserUploadOrigins() {
  const configured = [
    process.env.SPACES_CORS_ORIGINS,
    process.env.CLIENT_ORIGIN,
    process.env.CLIENT_URLS,
    process.env.FRONTEND_URL,
    process.env.APP_URL,
    process.env.STORAGE_PUBLIC_API_ORIGIN
  ].filter(Boolean).join(',').split(',').map(value => value.trim().replace(/\/+$/, '')).filter(Boolean);
  return [...new Set(['https://crmananttattva.com', 'https://crmananttattva.vercel.app', ...configured]
    .filter(value => /^https?:\/\/[^/]+$/i.test(value)))];
}
async function ensureUploadCors() {
  const c = config();
  const origins = browserUploadOrigins();
  const identity = JSON.stringify([c.bucket, origins]);
  if (uploadCorsPromise && uploadCorsIdentity === identity) return uploadCorsPromise;
  uploadCorsIdentity = identity;
  uploadCorsPromise = (async () => {
    let rules = [];
    try {
      rules = (await c.client.send(new GetBucketCorsCommand({ Bucket: c.bucket }))).CORSRules || [];
    } catch (error) {
      if (![404, 'NoSuchCORSConfiguration', 'NoSuchKey'].includes(error?.$metadata?.httpStatusCode)
        && !['NoSuchCORSConfiguration', 'NoSuchKey'].includes(error?.name)) throw error;
    }
    const managedRule = {
      ID: 'ananttattva-crm-browser-uploads',
      AllowedOrigins: origins,
      AllowedMethods: ['PUT', 'GET', 'HEAD'],
      AllowedHeaders: ['*'],
      ExposeHeaders: ['ETag', 'x-amz-request-id'],
      MaxAgeSeconds: 3600
    };
    const retained = rules.filter(rule => rule.ID !== managedRule.ID);
    await c.client.send(new PutBucketCorsCommand({ Bucket: c.bucket, CORSConfiguration: { CORSRules: [...retained, managedRule] } }));
    return managedRule;
  })().catch(error => {
    uploadCorsPromise = null;
    throw error;
  });
  return uploadCorsPromise;
}
async function putFile(key, body, size, type, metadata = {}) {
  if (!validKey(key)) throw new Error('Invalid object key.');
  const c = config();
  return c.client.send(new PutObjectCommand({ Bucket: c.bucket, Key: key, Body: body, ContentLength: size, ContentType: type || 'application/octet-stream', ContentDisposition: disposition(type), ACL: 'private', Metadata: metadata }));
}
async function head(key) { const c = config(); return c.client.send(new HeadObjectCommand({ Bucket: c.bucket, Key: key })); }
async function get(key) { const c = config(); return c.client.send(new GetObjectCommand({ Bucket: c.bucket, Key: key })); }
async function downloadUrl(key) { const c = config(); return getSignedUrl(c.client, new GetObjectCommand({ Bucket: c.bucket, Key: rawKey(key) }), { expiresIn: 60 }); }
async function uploadBuffer(buffer, name, type, folder) { const key = uploadKey(folder, name); await putFile(key, buffer, buffer.length, type); return objectResult(key, buffer.length); }
async function deleteObject(value) { if (!value.startsWith('spaces:') && !value.startsWith('spaces/crm/')) throw new Error('Not a Spaces identifier.'); const key = rawKey(value); if (!validKey(key)) throw new Error('Invalid object key.'); const c = config(); await c.client.send(new DeleteObjectCommand({ Bucket: c.bucket, Key: key })); }
async function authorizeUpload({ name, type, size, folder, checksum }, userId) {
  const maximum = Number(process.env.SPACES_UPLOAD_MAX_MB || 25) * 1024 * 1024;
  if (!name || !Number.isSafeInteger(size) || size < 1 || size > maximum || typeof type !== 'string' || type.length > 120 || /[\r\n]/.test(type) || !/^[A-Za-z0-9+/]{43}=$/.test(checksum || '')) throw new Error('Invalid file or configured size limit exceeded.');
  type = type || 'application/octet-stream';
  await ensureUploadCors();
  const key = uploadKey(folder, name); const c = config();
  const digest = Buffer.from(checksum, 'base64').toString('hex');
  const receipt = Buffer.from(JSON.stringify({ key, name, type, size, digest, userId: String(userId), expires: Date.now() + 15 * 60 * 1000 })).toString('base64url');
  const token = `${receipt}.${sign(`upload:${receipt}`)}`;
  const headers = { 'Content-Type': type, 'Content-Disposition': disposition(type), 'x-amz-checksum-sha256': checksum };
  const uploadUrl = await getSignedUrl(c.client, new PutObjectCommand({ Bucket: c.bucket, Key: key, ContentType: type, ContentDisposition: disposition(type), ChecksumSHA256: checksum, Metadata: { sha256: digest } }), { expiresIn: 600, unhoistableHeaders: new Set(['x-amz-checksum-sha256']) });
  return { uploadUrl, token, headers };
}
async function confirmUpload(token, userId) {
  const [receipt, signature] = String(token || '').split('.');
  if (!receipt || !equalSignature(`upload:${receipt}`, signature)) throw new Error('Invalid upload receipt.');
  const data = JSON.parse(Buffer.from(receipt, 'base64url').toString());
  if (data.expires < Date.now() || data.userId !== String(userId)) throw new Error('Expired or unauthorized upload receipt.');
  const metadata = await head(data.key);
  if (metadata.ContentLength !== data.size || metadata.ContentType !== data.type || metadata.Metadata?.sha256 !== data.digest) throw new Error('Uploaded object does not match the authorized file.');
  return { ...objectResult(data.key, data.size), name: data.name, type: data.type, uploadedAt: new Date().toISOString() };
}
module.exports = { config, validKey, fileUrl, validLink, managedUrl, putFile, head, get, downloadUrl, uploadBuffer, deleteObject, authorizeUpload, confirmUpload, ensureUploadCors, browserUploadOrigins, objectResult, rawKey };
