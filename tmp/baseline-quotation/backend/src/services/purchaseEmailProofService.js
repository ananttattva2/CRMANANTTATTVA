const crypto = require('node:crypto');
const path = require('node:path');
const { simpleParser } = require('mailparser');
const sanitizeHtml = require('sanitize-html');
const MsgReader = require('@kenjiuno/msgreader').default;
const { decompressRTF } = require('@kenjiuno/decompressrtf');

const ACTIVE_HTML = { allowedTags: ['p', 'br', 'div', 'span', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a'], allowedAttributes: { a: ['href', 'title'] }, allowedSchemes: ['http', 'https', 'mailto'], disallowedTagsMode: 'discard', transformTags: { a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' }) } };
const limit = (name, fallback) => Math.max(1, Number(process.env[name]) || fallback);
const LIMITS = () => ({ maxFile: limit('EMAIL_PROOF_MAX_SIZE_MB', 15) * 1024 * 1024, maxAttachment: limit('EMAIL_ATTACHMENT_MAX_SIZE_MB', 10) * 1024 * 1024, maxCount: limit('EMAIL_ATTACHMENT_MAX_COUNT', 20), maxTotal: limit('EMAIL_EXTRACTED_TOTAL_MAX_MB', 30) * 1024 * 1024 });

function safeName(value, fallback = 'email-proof') { return path.basename(String(value || fallback)).replace(/[^a-zA-Z0-9._ -]+/g, '_').slice(0, 180) || fallback; }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function addressList(value) { return (value?.value || []).slice(0, 100).map((item) => ({ name: String(item.name || '').slice(0, 200), email: String(item.address || '').toLowerCase().slice(0, 320) })); }
function headerList(headers) { return [...(headers?.entries?.() || [])].slice(0, 100).map(([name, value]) => ({ name: String(name).slice(0, 100), value: String(value).slice(0, 2000) })); }
function cleanText(value) { return String(value || '').replace(/\0/g, '').slice(0, 500000); }
function sanitized(value) { return sanitizeHtml(String(value || ''), ACTIVE_HTML).slice(0, 500000); }
function dateValue(value) { const date = value ? new Date(value) : null; return date && !Number.isNaN(date.getTime()) ? date : null; }
function readableRtf(value) {
  try {
    const rtf = Buffer.from(decompressRTF(value)).toString('latin1');
    return rtf.replace(/\\par[d]?\b/g, '\n').replace(/\\'[0-9a-f]{2}/gi, (match) => String.fromCharCode(parseInt(match.slice(2), 16))).replace(/\\[a-z]+-?\d* ?/gi, '').replace(/[{}]/g, '').replace(/\n{3,}/g, '\n\n').trim();
  } catch { return ''; }
}

function detectEmailFormat(file) {
  const extension = path.extname(file.originalname || '').toLowerCase();
  const mime = String(file.mimetype || '').toLowerCase();
  const msgSignature = Buffer.from(file.buffer).subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  const prefix = Buffer.from(file.buffer).subarray(0, Math.min(file.size, 8192)).toString('latin1');
  const emlSignature = /(^|\r?\n)(from|to|subject|date|message-id|mime-version):/im.test(prefix);
  if ((extension === '.msg' || mime === 'application/vnd.ms-outlook') && msgSignature) return 'msg';
  if ((extension === '.eml' || mime === 'message/rfc822' || mime === 'text/plain') && emlSignature) return 'eml';
  const error = new Error('The file extension or MIME type does not match a valid EML/MSG email signature.'); error.code = 'EMAIL_SIGNATURE_INVALID'; throw error;
}

function validateFile(file) {
  if (!file?.buffer?.length) { const error = new Error('Select an EML or MSG email file.'); error.code = 'EMAIL_FILE_REQUIRED'; throw error; }
  if (file.size > LIMITS().maxFile) { const error = new Error(`Email proof exceeds the ${limit('EMAIL_PROOF_MAX_SIZE_MB', 15)} MB limit.`); error.code = 'EMAIL_TOO_LARGE'; throw error; }
  return detectEmailFormat(file);
}

async function parseEml(buffer) {
  const mail = await simpleParser(buffer, { skipHtmlToText: false, skipTextToHtml: true, maxHtmlLengthToParse: 500000 });
  const html = typeof mail.html === 'string' ? mail.html : '';
  const attachments = (mail.attachments || []).map((item, index) => ({ attachmentId: crypto.randomUUID(), fileName: safeName(item.filename, `attachment-${index + 1}`), contentType: String(item.contentType || 'application/octet-stream'), size: item.size || item.content?.length || 0, contentId: String(item.cid || ''), isInline: String(item.contentDisposition || '').toLowerCase() === 'inline', content: item.content }));
  return { format: 'eml', messageId: String(mail.messageId || '').slice(0, 500), subject: cleanText(mail.subject).slice(0, 1000), from: addressList(mail.from)[0] || { name: '', email: '' }, to: addressList(mail.to), cc: addressList(mail.cc), bcc: addressList(mail.bcc), replyTo: addressList(mail.replyTo), sentAt: dateValue(mail.date), receivedAt: dateValue(mail.headers?.get?.('received-date') || mail.date), textBody: cleanText(mail.text), sanitizedHtmlBody: sanitized(html), headers: headerList(mail.headers), attachments, decodeWarnings: [] };
}

function msgRecipients(mail, type) { return (mail.recipients || []).filter((item) => String(item.recipType || 'to').toLowerCase() === type).map((item) => ({ name: cleanText(item.name).slice(0, 200), email: cleanText(item.email).toLowerCase().slice(0, 320) })); }
async function parseMsg(buffer) {
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const reader = new MsgReader(arrayBuffer); const mail = reader.getFileData();
  if (mail?.error) { const error = new Error('The Outlook message appears incomplete or corrupted.'); error.code = 'MSG_PARSE_FAILED'; throw error; }
  const attachments = (mail.attachments || []).map((item, index) => { const decoded = reader.getAttachment(item); const content = Buffer.from(decoded?.content || []); return { attachmentId: crypto.randomUUID(), fileName: safeName(decoded?.fileName || item.fileName, `attachment-${index + 1}`), contentType: 'application/octet-stream', size: content.length, contentId: '', isInline: false, content }; });
  const headers = cleanText(mail.headers).split(/\r?\n/).filter((line) => line.includes(':')).slice(0, 100).map((line) => { const separator = line.indexOf(':'); return { name: line.slice(0, separator).trim().slice(0, 100), value: line.slice(separator + 1).trim().slice(0, 2000) }; });
  const header = (name) => headers.find((item) => item.name.toLowerCase() === name)?.value || '';
  const rtfBody = !mail.body && mail.compressedRtf ? readableRtf(mail.compressedRtf) : '';
  return { format: 'msg', messageId: header('message-id').slice(0, 500), subject: cleanText(mail.subject).slice(0, 1000), from: { name: cleanText(mail.senderName).slice(0, 200), email: cleanText(mail.senderEmail).toLowerCase().slice(0, 320) }, to: msgRecipients(mail, 'to'), cc: msgRecipients(mail, 'cc'), bcc: msgRecipients(mail, 'bcc'), replyTo: [], sentAt: dateValue(mail.clientSubmitTime || header('date')), receivedAt: dateValue(mail.messageDeliveryTime || mail.creationTime), textBody: cleanText(mail.body || rtfBody), sanitizedHtmlBody: sanitized(mail.bodyHTML || mail.htmlBody || ''), headers, attachments, decodeWarnings: mail.compressedRtf && !mail.body && !rtfBody ? ['RTF content was present but could not be converted safely.'] : [] };
}

function validateDecoded(data) {
  const warnings = [...(data.decodeWarnings || [])];
  if (!data.from?.email && !data.from?.name) warnings.push('Sender information is missing.');
  if (!data.sentAt && !data.receivedAt) warnings.push('Sent/received date is missing.');
  if (!data.textBody && !data.sanitizedHtmlBody) warnings.push('Email body is empty.');
  const valid = Boolean((data.subject || data.textBody || data.sanitizedHtmlBody) && (data.from?.email || data.from?.name));
  return { ...data, decodeStatus: valid ? (warnings.length ? 'PartiallyDecoded' : 'Decoded') : 'Failed', decodeWarnings: warnings };
}

function enforceAttachmentLimits(attachments) {
  const limits = LIMITS();
  if (attachments.length > limits.maxCount) { const error = new Error(`Email contains more than ${limits.maxCount} attachments.`); error.code = 'TOO_MANY_ATTACHMENTS'; throw error; }
  let total = 0; attachments.forEach((item) => { if (item.size > limits.maxAttachment) { const error = new Error(`${item.fileName} exceeds the attachment size limit.`); error.code = 'ATTACHMENT_TOO_LARGE'; throw error; } total += item.size; });
  if (total > limits.maxTotal) { const error = new Error('Extracted attachments exceed the total size limit.'); error.code = 'ATTACHMENTS_TOTAL_TOO_LARGE'; throw error; }
}

async function decodeEmail(file, format) {
  const parsed = format === 'eml' ? await parseEml(file.buffer) : await parseMsg(file.buffer);
  const removedCount = parsed.attachments.length;
  return validateDecoded({
    ...parsed,
    attachments: [],
    decodeWarnings: [...(parsed.decodeWarnings || []), ...(removedCount ? [`${removedCount} email attachment(s) were intentionally ignored.`] : [])]
  });
}

async function uploadBuffer(buffer, name, mimeType, folder) {
  return require('./spacesStorage').uploadBuffer(buffer, safeName(name), mimeType, folder);
}
async function deleteStored(storageKey) {
  if (!storageKey) return;
  // Never delete legacy Cloudinary data: retirement requires separate explicit approval.
  if (storageKey.startsWith('spaces:') || storageKey.startsWith('spaces/crm/')) return require('./spacesStorage').deleteObject(storageKey);
}

function publicEmailData(data, attachments) { return { ...data, attachments: attachments.map(({ content, storageUrl, ...item }) => item) }; }

function emailBodyOnlyBuffer(data = {}) {
  const cleanHeader = (value) => String(value || '').replace(/[\r\n]+/g, ' ').trim();
  const address = (item = {}) => item.email ? `${cleanHeader(item.name)}${item.name ? ' ' : ''}<${cleanHeader(item.email)}>` : cleanHeader(item.name);
  const lines = [
    ['From', address(data.from)],
    ['To', (data.to || []).map(address).filter(Boolean).join(', ')],
    ['Cc', (data.cc || []).map(address).filter(Boolean).join(', ')],
    ['Subject', cleanHeader(data.subject)],
    ['Message-ID', cleanHeader(data.messageId)],
    ['Date', data.sentAt ? new Date(data.sentAt).toUTCString() : '']
  ].filter(([, value]) => value).map(([name, value]) => `${name}: ${value}`);
  const html = String(data.sanitizedHtmlBody || '').trim();
  const body = String(data.textBody || html || '').slice(0, 500000);
  lines.push('MIME-Version: 1.0', `Content-Type: ${data.textBody ? 'text/plain' : 'text/html'}; charset=utf-8`, 'Content-Transfer-Encoding: 8bit', 'X-CRM-Attachments-Removed: true');
  return Buffer.from(`${lines.join('\r\n')}\r\n\r\n${body}`, 'utf8');
}

module.exports = { LIMITS, safeName, sha256, validateFile, decodeEmail, emailBodyOnlyBuffer, uploadBuffer, deleteStored, publicEmailData };
