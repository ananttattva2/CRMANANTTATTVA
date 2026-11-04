const EMAIL_TYPES = new Set(['message/rfc822', 'application/eml', 'text/x-eml']);
const snapshot = read => { try { return Array.from(read() || []).filter(Boolean); } catch { return []; } };

export function isNativeProofDrop(dataTransfer) {
  return snapshot(() => dataTransfer?.files).length > 0
    || snapshot(() => dataTransfer?.items).some(item => item.kind === 'file')
    || snapshot(() => dataTransfer?.types).some(type => /^(?:Files|FileGroupDescriptorW?|FileContents)$/i.test(type));
}

function bounded(start, timeoutMs) {
  let cancel;
  const promise = new Promise(resolve => {
    let settled = false;
    const finish = value => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } };
    const timer = setTimeout(() => finish(null), timeoutMs);
    cancel = () => finish(null);
    try { start(finish); } catch { finish(null); }
  });
  promise.cancel = () => cancel();
  return promise;
}

function rawEmailFile(value) {
  const text = String(value || '').replace(/^\uFEFF/, '');
  const separator = text.search(/\r?\n\r?\n/);
  if (separator < 0) return null;
  const headers = text.slice(0, separator);
  // A subject/link or an HTML selection is not the original email proof.
  if (!/^From:\s*\S/im.test(headers) || !/^(?:To|Date|Message-ID):\s*\S/im.test(headers) || !/^(?:Subject|MIME-Version):/im.test(headers)) return null;
  const subject = (headers.match(/^Subject:\s*(.*)$/im)?.[1] || 'Outlook email').trim();
  const name = subject.replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Outlook email';
  return new File([text], `${name}.eml`, { type: 'message/rfc822' });
}

// Call this directly in the drop handler. All protected DataTransfer methods
// must be started synchronously, before the browser closes the drop data store.
export function droppedProofFiles(dataTransfer, { timeoutMs = 10000 } = {}) {
  const direct = snapshot(() => dataTransfer?.files);
  const items = snapshot(() => dataTransfer?.items);
  const immediate = items.map(item => {
    try { return item.kind === 'file' ? item.getAsFile?.() || null : null; } catch { return null; }
  });
  const fileReads = items.map((item, index) => {
    if (immediate[index]?.size > 0 || item.kind !== 'file') return Promise.resolve(immediate[index]);
    let handleRead = Promise.resolve(null);
    let entryRead = Promise.resolve(null);
    if (typeof item.getAsFileSystemHandle === 'function') {
      // Invoke now, not after awaiting another item or reading an email string.
      handleRead = bounded(done => {
        Promise.resolve(item.getAsFileSystemHandle()).then(handle => handle?.kind === 'file' ? handle.getFile() : null).then(done, () => done(null));
      }, timeoutMs);
    }
    if (typeof item.webkitGetAsEntry === 'function' || typeof item.getAsEntry === 'function') {
      entryRead = bounded(done => {
        const entry = (item.getAsEntry || item.webkitGetAsEntry).call(item);
        if (entry?.isFile) entry.file(done, () => done(null));
        else done(null);
      }, timeoutMs);
    }
    return Promise.any([handleRead, entryRead].map(read => read.then(file => file?.size > 0 ? file : Promise.reject(null))))
      .catch(() => immediate[index])
      .finally(() => { handleRead.cancel?.(); entryRead.cancel?.(); });
  });

  const strings = [];
  if (!direct.some(file => file.size > 0) && !immediate.some(file => file?.size > 0)) {
    for (const type of snapshot(() => dataTransfer?.types)) {
      if (!EMAIL_TYPES.has(type.toLowerCase()) && !['text/plain', 'text'].includes(type.toLowerCase())) continue;
      try { const value = dataTransfer.getData?.(type); if (value) strings.push(Promise.resolve(value)); } catch { /* protected or unsupported format */ }
    }
    for (const item of items) {
      if (item.kind !== 'string' || typeof item.getAsString !== 'function') continue;
      if (!EMAIL_TYPES.has(String(item.type || '').toLowerCase()) && !['text/plain', 'text'].includes(String(item.type || '').toLowerCase())) continue;
      strings.push(bounded(done => item.getAsString(done), Math.min(timeoutMs, 2000)));
    }
  }

  return Promise.all(fileReads).then(async values => {
    const result = [...direct];
    const key = file => `${file.name}\u0000${file.size}\u0000${file.lastModified || 0}`;
    const represented = new Map();
    direct.forEach(file => represented.set(key(file), (represented.get(key(file)) || 0) + 1));
    for (const file of values.filter(Boolean)) {
      const count = represented.get(key(file)) || 0;
      if (count) represented.set(key(file), count - 1);
      else result.push(file);
    }
    const populated = result.filter(file => file.size > 0);
    if (populated.length) {
      strings.forEach(read => read.cancel?.());
      return result.filter(file => file.size > 0 || !populated.some(other => other.name === file.name));
    }
    for (const read of strings) {
      const value = await read;
      const file = rawEmailFile(value);
      if (file) { strings.forEach(pending => pending.cancel?.()); return [file]; }
    }
    return result;
  });
}
