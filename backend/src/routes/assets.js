const express = require('express');
const spaces = require('../services/spacesStorage');
const multer = require('multer');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const DEFAULT_LOGO_URL = 'https://crm.ananttattva.com/assets/at-logo-CTH78yrR.svg';
let cachedLogo = null;
let cachedContentType = 'image/svg+xml';

// Same-origin fallback when browser-to-Spaces CORS/network access is unavailable.
const receiveFile = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1, fields: 2 } }).single('file');
router.post('/upload', requireAuth, (req, res) => {
  receiveFile(req, res, async error => {
    if (error || !req.file) return res.status(400).json({ error: 'Invalid upload or file exceeds 25 MB.' });
    if (crypto.createHash('sha256').update(req.file.buffer).digest('base64') !== req.body.checksum) return res.status(400).json({ error: 'Upload checksum mismatch.' });
    try {
      const stored = await spaces.uploadBuffer(req.file.buffer, req.file.originalname, req.file.mimetype, req.body.folder || 'crm/uploads');
      return res.json({ ...stored, name: req.file.originalname, type: req.file.mimetype, uploadedAt: new Date().toISOString() });
    } catch { return res.status(503).json({ error: 'Spaces storage upload failed.' }); }
  });
});

router.post('/upload-url', requireAuth, async (req, res) => {
  try { return res.json(await spaces.authorizeUpload(req.body || {}, req.user._id)); }
  catch { return res.status(400).json({ error: 'Upload authorization failed. Check file size and Spaces configuration.' }); }
});
router.post('/upload-confirm', requireAuth, async (req, res) => {
  try { return res.json(await spaces.confirmUpload(req.body?.token, req.user._id)); }
  catch { return res.status(400).json({ error: 'Upload could not be verified.' }); }
});
// Stable capability links preserve existing preview UI; possession of a link grants access.
router.get('/file', async (req, res) => {
  const controller = new AbortController();
  let object;
  const cancel = () => {
    controller.abort();
    object?.Body?.destroy();
  };
  res.once('close', cancel);
  try {
    const key = String(req.query.key || '');
    if (!spaces.validLink(key, String(req.query.signature || ''))) return res.status(403).json({ error: 'Invalid file link.' });
    res.set({ 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' });
    object = await spaces.get(key, { abortSignal: controller.signal });
    if (res.destroyed) { object.Body?.destroy(); return; }
    res.set({ 'Content-Type': object.ContentType || 'application/octet-stream', 'Content-Disposition': object.ContentDisposition || 'attachment', 'X-Content-Type-Options': 'nosniff' });
    if (Number.isFinite(object.ContentLength)) res.set('Content-Length', String(object.ContentLength));
    await pipeline(object.Body, res);
  } catch {
    if (res.destroyed) return;
    if (res.headersSent) return res.destroy();
    return res.status(503).json({ error: 'File storage is unavailable.' });
  } finally {
    res.off('close', cancel);
    object?.Body?.destroy();
  }
});

router.get('/brand-logo', async (req, res) => {
  try {
    if (!cachedLogo) {
      const response = await fetch(String(process.env.MAIL_LOGO_URL || DEFAULT_LOGO_URL));
      if (!response.ok) throw new Error(`Logo server returned ${response.status}`);
      cachedLogo = Buffer.from(await response.arrayBuffer());
      cachedContentType = response.headers.get('content-type') || 'image/svg+xml';
    }
    res.set({ 'Content-Type': cachedContentType, 'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800' });
    return res.send(cachedLogo);
  } catch (error) {
    return res.status(502).json({ error: 'Company logo is temporarily unavailable' });
  }
});

module.exports = router;
