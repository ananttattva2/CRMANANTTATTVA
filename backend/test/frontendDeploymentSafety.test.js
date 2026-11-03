const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');

test('frontend recovers once from stale dynamic-import assets', () => {
  const html = fs.readFileSync(path.join(root, 'frontend', 'index.html'), 'utf8');
  assert.match(html, /vite:preloadError/);
  assert.match(html, /failed to fetch dynamically imported module/i);
  assert.match(html, /\/assets\\\/\[\^\/\]\+\\\.\(\?:css\|js\)/);
  assert.match(html, /Date\.now\(\) - lastAttempt < 60000/);
});

test('production deploy retains previous chunks and verifies module MIME type', () => {
  const script = fs.readFileSync(path.join(root, 'scripts', 'deploy-production.sh'), 'utf8');
  assert.match(script, /FRONTEND_ENTRY_ASSETS/);
  assert.match(script, /cp --preserve=timestamps --no-clobber/);
  assert.match(script, /-mtime -14/);
  assert.match(script, /ENTRY_CONTENT_TYPE/);
  assert.match(script, /javascript\|text\/css/);
});
