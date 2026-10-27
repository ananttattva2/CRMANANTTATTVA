const MAX_BODY_CHARS = 1_000_000;

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

async function msgToMailOnlyEml(file) {
  const { default: MsgReader } = await import('@kenjiuno/msgreader');
  const reader = new MsgReader(await file.arrayBuffer());
  const mail = reader.getFileData();
  if (mail?.error) throw new Error('The Outlook email could not be read.');
  const body = String(mail.body || '').trim();
  const html = String(mail.bodyHTML || mail.htmlBody || '').trim();
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
    body: body || html,
    contentType: body ? 'text/plain; charset=utf-8' : 'text/html; charset=utf-8',
    encoding: '8bit'
  });
}

export async function emailProofWithoutAttachments(file) {
  const isMsg = /\.msg$/i.test(file?.name || '') || String(file?.type || '').toLowerCase() === 'application/vnd.ms-outlook';
  const content = isMsg ? await msgToMailOnlyEml(file) : stripEmlAttachments(await file.text());
  const stem = String(file?.name || 'email-proof').replace(/\.(eml|msg)$/i, '').replace(/[^a-z0-9._ -]+/gi, '_').slice(0, 120) || 'email-proof';
  return new File([content], `${stem}-mail-only.eml`, { type: 'message/rfc822', lastModified: file?.lastModified || Date.now() });
}
