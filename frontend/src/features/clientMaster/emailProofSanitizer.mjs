const MAX_BODY_CHARS = 1_000_000;

function decodeRtfFragment(value = '') {
  const source = String(value || '');
  let output = '';
  for (let index = 0; index < source.length;) {
    const character = source[index];
    if (character === '{' || character === '}') { index += 1; continue; }
    if (character !== '\\') { output += character; index += 1; continue; }
    const next = source[index + 1];
    if (next === '\\' || next === '{' || next === '}') { output += next; index += 2; continue; }
    if (next === "'" && /^[0-9a-f]{2}$/i.test(source.slice(index + 2, index + 4))) {
      output += new TextDecoder('windows-1252').decode(Uint8Array.of(parseInt(source.slice(index + 2, index + 4), 16)));
      index += 4; continue;
    }
    if (!/[a-z]/i.test(next || '')) { index += 2; continue; }
    const control = source.slice(index + 1).match(/^([a-z]+)(-?\d+)? ?/i);
    if (!control) { index += 1; continue; }
    const [, word, numeric] = control;
    index += 1 + control[0].length;
    if (word === 'par' || word === 'line') output += '\n';
    else if (word === 'tab') output += '\t';
    else if (word === 'u' && numeric != null) {
      const code = Number(numeric); output += String.fromCharCode(code < 0 ? code + 65536 : code);
      if (source[index] && source[index] !== '\\' && source[index] !== '{' && source[index] !== '}') index += 1;
    }
  }
  return output;
}

export function extractHtmlFromRtf(value = '') {
  const source = String(value || '');
  const marker = '{\\*\\htmltag';
  let html = ''; let htmlText = false; let index = 0;
  while (index < source.length) {
    if (source.startsWith(marker, index)) {
      let contentStart = index + marker.length;
      while (/\d/.test(source[contentStart] || '')) contentStart += 1;
      while (/\s/.test(source[contentStart] || '')) contentStart += 1;
      let depth = 1; let cursor = contentStart;
      for (; cursor < source.length && depth > 0; cursor += 1) {
        if (source[cursor] === '\\') { cursor += 1; continue; }
        if (source[cursor] === '{') depth += 1;
        else if (source[cursor] === '}') depth -= 1;
      }
      if (depth === 0) html += decodeRtfFragment(source.slice(contentStart, cursor - 1));
      index = Math.max(cursor, index + marker.length); continue;
    }
    const character = source[index];
    if (character === '{' || character === '}') { index += 1; continue; }
    if (character !== '\\') { if (htmlText) html += character; index += 1; continue; }
    const next = source[index + 1];
    if (next === '\\' || next === '{' || next === '}') { if (htmlText) html += next; index += 2; continue; }
    if (next === "'" && /^[0-9a-f]{2}$/i.test(source.slice(index + 2, index + 4))) {
      if (htmlText) html += new TextDecoder('windows-1252').decode(Uint8Array.of(parseInt(source.slice(index + 2, index + 4), 16)));
      index += 4; continue;
    }
    const control = source.slice(index + 1).match(/^([a-z]+)(-?\d+)? ?/i);
    if (!control) { index += 2; continue; }
    const [, word, numeric] = control; index += 1 + control[0].length;
    if (word === 'htmlrtf') { htmlText = numeric === '0'; continue; }
    if (!htmlText) continue;
    if (word === 'par' || word === 'line') html += '\n';
    else if (word === 'tab') html += '\t';
    else if (word === 'u' && numeric != null) {
      const code = Number(numeric); html += String.fromCharCode(code < 0 ? code + 65536 : code);
      if (source[index] && source[index] !== '\\' && source[index] !== '{' && source[index] !== '}') index += 1;
    }
  }
  html = html.replace(/\0/g, '').trim();
  return /<(?:html|body|table|p|div)\b/i.test(html) ? html.slice(0, MAX_BODY_CHARS) : '';
}

function splitEntity(value = '') {
  const match = String(value).match(/\r?\n\r?\n/);
  if (!match || match.index === undefined) return { headers: String(value), body: '' };
  return { headers: String(value).slice(0, match.index), body: String(value).slice(match.index + match[0].length) };
}

function unfoldHeaders(value = '') {
  return String(value).replace(/\r?\n[ \t]+/g, ' ');
}

function headerValue(headers, name) {
  const match = unfoldHeaders(headers).match(new RegExp(`^${name}:\\s*(.*)$`, 'im'));
  return String(match?.[1] || '').trim();
}

function safeHeader(value = '') {
  return String(value).replace(/[\r\n]+/g, ' ').trim();
}

function boundaryFrom(contentType = '') {
  const match = String(contentType).match(/boundary\s*=\s*(?:"([^"]+)"|([^;\s]+))/i);
  return match?.[1] || match?.[2] || '';
}

function multipartParts(body, boundary) {
  if (!boundary) return [];
  return String(body).split(`--${boundary}`).slice(1).map((part) => part.replace(/^\r?\n/, '').replace(/\r?\n--\s*$/, '').trim()).filter(Boolean);
}

function extractReadablePart(headers, body, depth = 0) {
  if (depth > 8) return null;
  const contentType = headerValue(headers, 'Content-Type') || 'text/plain; charset=utf-8';
  const disposition = headerValue(headers, 'Content-Disposition');
  if (/attachment/i.test(disposition) || /filename\s*=/i.test(`${contentType};${disposition}`)) return null;
  if (/^multipart\//i.test(contentType)) {
    const candidates = multipartParts(body, boundaryFrom(contentType))
      .map((part) => { const entity = splitEntity(part); return extractReadablePart(entity.headers, entity.body, depth + 1); })
      .filter(Boolean);
    return candidates.find((part) => /^text\/plain/i.test(part.contentType)) || candidates.find((part) => /^text\/html/i.test(part.contentType)) || candidates[0] || null;
  }
  if (/^message\/rfc822/i.test(contentType)) {
    const nested = splitEntity(body);
    return extractReadablePart(nested.headers, nested.body, depth + 1);
  }
  if (!/^text\/(plain|html)/i.test(contentType)) return null;
  return { contentType, encoding: headerValue(headers, 'Content-Transfer-Encoding'), body: String(body).slice(0, MAX_BODY_CHARS) };
}

function buildMailOnlyEml({ headers = {}, body = '', contentType = 'text/plain; charset=utf-8', encoding = '8bit' }) {
  const lines = [
    ['From', headers.from], ['To', headers.to], ['Cc', headers.cc], ['Subject', headers.subject],
    ['Date', headers.date], ['Message-ID', headers.messageId]
  ].filter(([, value]) => safeHeader(value)).map(([name, value]) => `${name}: ${safeHeader(value)}`);
  lines.push('MIME-Version: 1.0', `Content-Type: ${safeHeader(contentType) || 'text/plain; charset=utf-8'}`);
  if (encoding) lines.push(`Content-Transfer-Encoding: ${safeHeader(encoding)}`);
  lines.push('X-CRM-Attachments-Removed: true');
  return `${lines.join('\r\n')}\r\n\r\n${String(body).slice(0, MAX_BODY_CHARS)}`;
}

export function stripEmlAttachments(raw = '') {
  const entity = splitEntity(raw);
  const readable = extractReadablePart(entity.headers, entity.body) || { contentType: 'text/plain; charset=utf-8', encoding: '8bit', body: '' };
  return buildMailOnlyEml({
    headers: {
      from: headerValue(entity.headers, 'From'), to: headerValue(entity.headers, 'To'), cc: headerValue(entity.headers, 'Cc'),
      subject: headerValue(entity.headers, 'Subject'), date: headerValue(entity.headers, 'Date'), messageId: headerValue(entity.headers, 'Message-ID')
    },
    ...readable
  });
}

function recipients(items = []) {
  return (items || []).map((item) => item?.email || item?.name || '').filter(Boolean).join(', ');
}

export function msgReaderConstructor(moduleValue) {
  const candidate = moduleValue?.default?.default || moduleValue?.default || moduleValue?.MsgReader || moduleValue;
  if (typeof candidate !== 'function') throw new Error('The Outlook email reader could not be loaded.');
  return candidate;
}

async function msgToMailOnlyEml(file) {
  const MsgReader = msgReaderConstructor(await import('@kenjiuno/msgreader'));
  const reader = new MsgReader(await file.arrayBuffer());
  const mail = reader.getFileData();
  if (mail?.error) throw new Error('The Outlook email could not be read.');
  const body = String(mail.body || '').trim();
  let html = String(mail.bodyHTML || mail.htmlBody || '').trim();
  if (!html && mail.compressedRtf) {
    const { decompressRTF } = await import('@kenjiuno/decompressrtf');
    const decompressed = new TextDecoder('windows-1252').decode(Uint8Array.from(decompressRTF(mail.compressedRtf)));
    html = extractHtmlFromRtf(decompressed);
  }
  if (!body && !html) throw new Error('The email body could not be read without its attachments.');
  const rawHeaders = String(mail.headers || '');
  return buildMailOnlyEml({
    headers: {
      from: mail.senderEmail ? `${mail.senderName || ''} <${mail.senderEmail}>` : mail.senderName,
      to: recipients((mail.recipients || []).filter((item) => String(item.recipType || 'to').toLowerCase() === 'to')),
      cc: recipients((mail.recipients || []).filter((item) => String(item.recipType || '').toLowerCase() === 'cc')),
      subject: mail.subject, date: mail.clientSubmitTime || mail.messageDeliveryTime || mail.creationTime,
      messageId: headerValue(rawHeaders, 'Message-ID')
    },
    body: html || body,
    contentType: html ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8',
    encoding: '8bit'
  });
}

export async function emailProofWithoutAttachments(file) {
  const isMsg = /\.msg$/i.test(file?.name || '') || String(file?.type || '').toLowerCase() === 'application/vnd.ms-outlook';
  const content = isMsg ? await msgToMailOnlyEml(file) : stripEmlAttachments(await file.text());
  const stem = String(file?.name || 'email-proof').replace(/\.(eml|msg)$/i, '').replace(/[^a-z0-9._ -]+/gi, '_').slice(0, 120) || 'email-proof';
  return new File([content], `${stem}-mail-only.eml`, { type: 'message/rfc822', lastModified: file?.lastModified || Date.now() });
}
