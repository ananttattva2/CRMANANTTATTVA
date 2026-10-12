const express = require('express');
const spaces = require('../services/spacesStorage');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const DEFAULT_LOGO_URL = 'https://crm.ananttattva.com/assets/at-logo-CTH78yrR.svg';
let cachedLogo = null;
let cachedContentType = 'image/svg+xml';

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
  try {
    const key = String(req.query.key || '');
    if (!spaces.validLink(key, String(req.query.signature || ''))) return res.status(403).json({ error: 'Invalid file link.' });
    res.set({ 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' });
    return res.redirect(await spaces.downloadUrl(key));
  } catch { return res.status(503).json({ error: 'File storage is unavailable.' }); }
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
