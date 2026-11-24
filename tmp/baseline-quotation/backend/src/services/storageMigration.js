const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const { EJSON } = require('bson');

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
function cloudUrl(value) { try { const u = new URL(value); return /^https?:$/.test(u.protocol) && u.hostname === 'res.cloudinary.com'; } catch { return false; } }
function normalizeUrl(value) { const u = new URL(value); u.protocol = 'https:'; return u.href; }
function walkReferences(value, visit, trail = []) {
  if (typeof value === 'string') {
    // Includes standalone URLs and links embedded in email HTML/text or JSON strings.
    const matches = value.match(/https?:\/\/res\.cloudinary\.com\/[^\s<>"'\\]+/g) || [];
    for (const url of new Set(matches.map(x => x.replace(/&amp;/g, '&')))) visit(url, trail, value);
  } else if (Array.isArray(value)) value.forEach((item, i) => walkReferences(item, visit, [...trail, String(i)]));
  else if (value && Object.getPrototypeOf(value) === Object.prototype) Object.entries(value).forEach(([key, item]) => {
    if (!key.includes('.') && !key.startsWith('$') && key !== '_id') walkReferences(item, visit, [...trail, key]);
  });
}
// Self-contained function for read-only MongoDB projection. No external captures.
function serverReferences(document) {
  var references = [];
  function walk(value, trail) {
    if (typeof value === 'string') {
      if (value.indexOf('res.cloudinary.com/') < 0) return;
      var matches = value.match(/https?:\/\/res\.cloudinary\.com\/[^\s<>"'\\]+/g) || [];
      var seen = {};
      matches.forEach(function(url) { url = url.replace(/&amp;/g, '&'); if (!seen[url]) { references.push({ url: url, path: trail.join('.') }); seen[url] = true; } });
    } else if (Array.isArray(value)) value.forEach(function(item, index) { walk(item, trail.concat(String(index))); });
    else if (value && typeof value === 'object') Object.keys(value).forEach(function(key) { if (key !== '_id' && key.indexOf('.') < 0 && key.charAt(0) !== '$') walk(value[key], trail.concat(key)); });
  }
  walk(document, []); return references;
}
function safePath(value) {
  if (!value || value.startsWith('/') || value.split('/').some(x => x === '..' || x === '.') || /[\x00-\x1f\x7f]/.test(value) || Buffer.byteLength(value) > 900) throw new Error('Unsafe or oversized Cloudinary folder/object path.');
  return value;
}
function originalKey(asset) {
  const id = safePath(asset.public_id);
  const directory = asset.asset_folder !== undefined ? asset.asset_folder : path.posix.dirname(id) === '.' ? '' : path.posix.dirname(id);
  const basename = path.posix.basename(id);
  const name = asset.resource_type === 'raw' || !asset.format || basename.endsWith(`.${asset.format}`) ? basename : `${basename}.${asset.format}`;
  return safePath(directory ? `${safePath(directory)}/${name}` : name);
}
function assignKeys(assets) {
  const groups = new Map();
  for (const asset of assets) {
    try { asset.key = originalKey(asset); const group = groups.get(asset.key) || []; group.push(asset); groups.set(asset.key, group); }
    catch (error) { asset.status = 'failed'; asset.error = error.message; }
  }
  const used = new Set();
  for (const group of groups.values()) for (const asset of group) {
    if (group.length > 1) {
      const ext = path.posix.extname(asset.key);
      asset.key = `${asset.key.slice(0, ext ? -ext.length : undefined)}--${asset.resource_type}-${asset.type}-${sha256(asset.id).slice(0, 16)}${ext}`;
      asset.collisionRenamed = true;
    }
    if (used.has(asset.key)) throw new Error('Destination key collision.');
    used.add(asset.key);
  }
}
function referenceAsset(url, related) {
  const id = `reference:${sha256(normalizeUrl(url))}`;
  let directory = 'crm/migration-unresolved'; let basename = 'file';
  if (related) { directory = path.posix.dirname(related.key || originalKey(related)); basename = path.posix.basename(related.key || originalKey(related)); }
  else { try { basename = decodeURIComponent(new URL(url).pathname.split('/').pop()) || 'file'; } catch {} }
  const ext = path.posix.extname(basename);
  return { id, sourceUrl: normalizeUrl(url), aliases: [url], kind: 'reference', key: safePath(`${directory === '.' ? '' : `${directory}/`}${basename.slice(0, ext ? -ext.length : undefined)}--reference-${sha256(id).slice(0, 16)}${ext}`), status: 'pending', references: [] };
}
function connectReferences(assets, references) {
  const aliases = new Map();
  for (const asset of assets) for (const alias of asset.aliases || []) if (cloudUrl(alias)) aliases.set(normalizeUrl(alias), asset);
  for (const ref of references) {
    const normalized = normalizeUrl(ref.url); let asset = aliases.get(normalized);
    if (!asset) {
      // A transformed/versioned URL is copied separately, retaining the exact referenced bytes.
      const decoded = decodeURIComponent(new URL(normalized).pathname);
      const related = assets.find(a => a.public_id && decoded.includes(`/${a.public_id}${a.resource_type === 'raw' || !a.format ? '' : `.${a.format}`}`));
      asset = referenceAsset(ref.url, related); assets.push(asset); aliases.set(normalized, asset);
    }
    if (!(asset.aliases || []).includes(ref.url)) asset.aliases.push(ref.url);
    asset.references ||= []; asset.references.push(ref);
  }
  return assets;
}
async function digestStream(stream) {
  const hash = crypto.createHash('sha256'); let size = 0;
  for await (const chunk of stream) { const bytes = Buffer.from(chunk); hash.update(bytes); size += bytes.length; }
  return { size, sha256: hash.digest('hex') };
}
function verified(source, destination, expectedBytes) {
  if (source.size !== destination.size || source.sha256 !== destination.sha256 || (Number.isFinite(expectedBytes) && source.size !== expectedBytes)) throw new Error('File size or SHA-256 verification failed.');
  return true;
}
function verifiedAliasIndex(assets) {
  const byUrl = new Map();
  for (const asset of assets) if (asset.status === 'verified') for (const url of asset.aliases || []) byUrl.set(normalizeUrl(url), asset);
  return byUrl;
}
function referencePatches(doc, assets, fileUrl, cachedIndex) {
  const byUrl = cachedIndex || verifiedAliasIndex(assets);
  const before = {}; const after = {}; const assetIds = new Set();
  walkReferences(doc, (url, trail, value) => {
    const asset = byUrl.get(normalizeUrl(url)); if (!asset) return;
    const field = trail.join('.'); if (!field) return;
    before[field] = value; const target = fileUrl(asset.key);
    after[field] = (after[field] || value).split(url).join(target).split(url.replace(/&/g, '&amp;')).join(target.replace(/&/g, '&amp;'));
    assetIds.add(asset.id);
    // Metadata identifiers are changed only when the value is a standalone verified URL.
    if (cloudUrl(value)) {
      let parent = doc; for (const part of trail.slice(0, -1)) parent = parent[part];
      for (const identifier of ['storageKey', 'publicId']) if (typeof parent[identifier] === 'string') {
        const sibling = [...trail.slice(0, -1), identifier].join('.'); before[sibling] = parent[identifier]; after[sibling] = `spaces:${asset.key}`;
      }
    }
  });
  return { before, after, assetIds: [...assetIds] };
}
function valuesMatch(doc, values) {
  return doc && Object.entries(values).every(([field, value]) => { let actual = doc; for (const part of field.split('.')) actual = actual?.[part]; return EJSON.stringify(actual) === EJSON.stringify(value); });
}
async function applyPatch(collection, patch, direction = 'forward', currentDocument) {
  const before = direction === 'forward' ? patch.before : patch.after;
  const after = direction === 'forward' ? patch.after : patch.before;
  const current = currentDocument || await collection.findOne({ _id: patch.documentId });
  if (valuesMatch(current, after)) return 'already-applied';
  if (!valuesMatch(current, before)) return 'conflict';
  const result = await collection.updateOne({ _id: patch.documentId, ...before }, { $set: after });
  return result.matchedCount === 1 ? 'applied' : 'conflict';
}
function atomicWrite(file, data) {
  const temporary = `${file}.tmp`; const fd = fs.openSync(temporary, 'w', 0o600);
  try { fs.writeFileSync(fd, EJSON.stringify(data, { relaxed: false })); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temporary, file);
}
function parseState(text) {
  const raw = JSON.parse(text); const state = EJSON.parse(text, { relaxed: true });
  // Runtime counters stay JS numbers; MongoDB identifiers retain exact BSON types/precision.
  function identifiers(source, target) {
    if (!source || typeof source !== 'object') return;
    for (const key of Object.keys(source)) {
      if (key === 'documentId') target[key] = EJSON.deserialize(source[key], { relaxed: false });
      else if (source[key] && typeof source[key] === 'object' && target[key] && typeof target[key] === 'object') identifiers(source[key], target[key]);
    }
  }
  identifiers(raw, state); return state;
}
function loadState(file) {
  const state = parseState(fs.readFileSync(file, 'utf8'));
  const journal = path.join(path.dirname(file), 'patch-journal.jsonl');
  if (path.basename(file) === 'state.json' && fs.existsSync(journal)) {
    const lines = fs.readFileSync(journal, 'utf8').split('\n'); lines.pop();
    for (const line of lines) {
      if (!line) continue;
      const entry = parseState(line);
      if (!Number.isSafeInteger(entry.index) || entry.index < 0 || entry.index > state.patches.length || entry.patch?.documentId === undefined || entry.patch.documentId === null) throw new Error('Corrupt patch journal; refusing database changes.');
      state.patches[entry.index] = entry.patch;
    }
  }
  return state;
}
function journalChanges(file, patches, knownStatuses) {
  if (fs.existsSync(file)) {
    const fd = fs.openSync(file, 'r+');
    try {
      const size = fs.fstatSync(fd).size;
      if (size) {
        const last = Buffer.alloc(1); fs.readSync(fd, last, 0, 1, size - 1);
        if (last[0] !== 10) { const data = fs.readFileSync(file); fs.ftruncateSync(fd, data.lastIndexOf(10) + 1); fs.fsyncSync(fd); }
      }
    } finally { fs.closeSync(fd); }
  }
  for (let index = 0; index < patches.length; index++) {
    const patch = patches[index]; if (knownStatuses.get(patch) === patch.status) continue;
    const fd = fs.openSync(file, 'a', 0o600);
    try { fs.writeSync(fd, EJSON.stringify({ index, patch }, { relaxed: false }) + '\n'); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    knownStatuses.set(patch, patch.status);
  }
}
function report(state) {
  const assets = state.assets || []; const count = status => assets.filter(a => a.status === status).length;
  return {
    runId: state.runId, generatedAt: new Date().toISOString(), discoveryComplete: !!state.discoveryComplete,
    total: assets.length, originals: assets.filter(a => a.kind === 'original').length, referencedVariantsOrMissing: assets.filter(a => a.kind === 'reference').length,
    successful: count('verified'), failed: count('failed'), missing: count('missing'), pending: count('pending'),
    bytesVerified: assets.filter(a => a.status === 'verified').reduce((sum, a) => sum + a.verification.size, 0),
    database: { journalEntries: (state.patches || []).length, updated: (state.patches || []).filter(p => p.status === 'applied').length, conflicts: (state.patches || []).filter(p => p.status === 'conflict').length, rolledBack: (state.patches || []).filter(p => p.status === 'rolled-back').length },
    discoveryErrors: state.discoveryErrors || [],
    files: assets.map(a => ({ id: a.id, kind: a.kind, publicId: a.public_id, folder: a.asset_folder, key: a.key, status: a.status, attempts: a.attempts || 0, size: a.verification?.size, sha256: a.verification?.sha256, referenceCount: a.references?.length || 0, collisionRenamed: !!a.collisionRenamed, error: a.error || '' }))
  };
}
module.exports = { sha256, cloudUrl, normalizeUrl, walkReferences, serverReferences, assignKeys, originalKey, connectReferences, digestStream, verified, verifiedAliasIndex, referencePatches, valuesMatch, applyPatch, atomicWrite, loadState, journalChanges, report };
