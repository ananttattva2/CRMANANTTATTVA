const nodemailer = require('nodemailer');

let graphTokenCache = {
  accessToken: '',
  expiresAt: 0,
  cacheKey: ''
};

function normalizeRecipients(to) {
  if (Array.isArray(to)) return to;
  return String(to || '')
    .split(/[,\s;]+/)
    .map((email) => email.trim())
    .filter(Boolean);
}

function readMailUser() {
  return process.env.SMTP_USER || process.env.MAIL_USER || process.env.EMAIL_USER || process.env.GMAIL_USER;
}

function readGraphConfig() {
  return {
    tenantId: String(process.env.MS_TENANT_ID || '').trim(),
    clientId: String(process.env.MS_CLIENT_ID || '').trim(),
    clientSecret: String(process.env.MS_CLIENT_SECRET || '').trim(),
    senderEmail: String(process.env.OTP_SENDER_EMAIL || process.env.MS_SENDER_EMAIL || '').trim()
  };
}

function isGraphConfigured(config = readGraphConfig()) {
  return Boolean(config.tenantId && config.clientId && config.clientSecret && config.senderEmail);
}

function readMailProvider() {
  const configuredProvider = String(process.env.MAIL_PROVIDER || '').trim().toLowerCase();
  if (configuredProvider === 'microsoft-graph' || configuredProvider === 'outlook' || configuredProvider === 'graph') {
    return 'microsoft-graph';
  }
  return isGraphConfigured() ? 'microsoft-graph' : 'smtp';
}

function readMailPass() {
  const mailPass = process.env.SMTP_PASS || process.env.MAIL_PASS || process.env.EMAIL_PASS || process.env.GMAIL_PASS;
  if (!mailPass) return mailPass;

  // Gmail app passwords are displayed in groups with spaces; SMTP auth expects the 16-character value.
  return process.env.MAIL_PASS_STRIP_SPACES === 'false'
    ? mailPass
    : String(mailPass).replace(/\s+/g, '');
}

function readMailFromName() {
  return String(process.env.MAIL_FROM_NAME || process.env.APP_NAME || 'CRM').trim() || 'CRM';
}

function quoteDisplayName(name) {
  return `"${String(name || 'CRM').replace(/["\\]/g, '')}"`;
}

function formatFromAddress() {
  const mailUser = readMailUser();
  const configuredFrom = String(process.env.MAIL_FROM || '').trim();
  const displayName = readMailFromName();

  if (configuredFrom) {
    const bracketMatch = configuredFrom.match(/<([^>]+)>/);
    if (bracketMatch) return `${quoteDisplayName(displayName)} <${bracketMatch[1].trim()}>`;
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(configuredFrom)) return `${quoteDisplayName(displayName)} <${configuredFrom}>`;
    return configuredFrom;
  }

  return mailUser ? `${quoteDisplayName(displayName)} <${mailUser}>` : undefined;
}

function createTransporter() {
  const mailUser = readMailUser();
  const mailPass = readMailPass();

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: mailUser && mailPass ? { user: mailUser, pass: mailPass } : undefined,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000
  });
}

function summarizeMailInfo(info) {
  return {
    messageId: info?.messageId,
    accepted: info?.accepted || [],
    rejected: info?.rejected || [],
    pending: info?.pending || [],
    response: info?.response,
    envelope: info?.envelope
  };
}

function getMailDebugConfig() {
  const mailUser = readMailUser();
  const graphConfig = readGraphConfig();
  const provider = readMailProvider();
  return {
    provider,
    sender: provider === 'microsoft-graph' ? graphConfig.senderEmail : formatFromAddress() || '',
    graphConfigured: isGraphConfigured(graphConfig),
    hasMicrosoftTenantId: Boolean(graphConfig.tenantId),
    hasMicrosoftClientId: Boolean(graphConfig.clientId),
    hasMicrosoftClientSecret: Boolean(graphConfig.clientSecret),
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    hasUser: Boolean(mailUser),
    userDomain: String(mailUser || '').split('@')[1] || '',
    hasPassword: Boolean(readMailPass()),
    from: formatFromAddress() || '',
    replyTo: process.env.MAIL_REPLY_TO || mailUser || ''
  };
}

function buildBrandedEmail(html) {
  const source = String(html || '');
  if (!source) return source;
  if (/<html\b/i.test(source) || /<body\b/i.test(source)) return source;
  return `<div style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">${source}</div>`;
}

async function readGraphError(response, fallbackMessage) {
  try {
    const payload = await response.json();
    const message = payload?.error?.message || payload?.error_description;
    return message ? `${fallbackMessage}: ${message}` : fallbackMessage;
  } catch (_error) {
    return fallbackMessage;
  }
}

async function getGraphAccessToken(config = readGraphConfig()) {
  if (!isGraphConfigured(config)) {
    throw new Error('Microsoft Graph mail is not fully configured');
  }

  const cacheKey = `${config.tenantId}:${config.clientId}`;
  if (
    graphTokenCache.accessToken
    && graphTokenCache.cacheKey === cacheKey
    && graphTokenCache.expiresAt > Date.now() + 60_000
  ) {
    return graphTokenCache.accessToken;
  }

  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials'
  });
  const response = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    }
  );

  if (!response.ok) {
    throw new Error(await readGraphError(response, `Microsoft Graph authentication failed (${response.status})`));
  }

  const token = await response.json();
  if (!token.access_token) throw new Error('Microsoft Graph authentication returned no access token');

  graphTokenCache = {
    accessToken: token.access_token,
    expiresAt: Date.now() + (Number(token.expires_in) || 3600) * 1000,
    cacheKey
  };
  return token.access_token;
}

function toGraphRecipients(recipients) {
  return recipients.map((address) => ({ emailAddress: { address } }));
}

function toGraphAttachments(attachments = []) {
  return attachments.map((attachment) => {
    const content = attachment.content;
    if (content === undefined || content === null) {
      throw new Error(`Microsoft Graph attachment "${attachment.filename || attachment.name || 'attachment'}" has no content`);
    }
    const graphAttachment = {
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: attachment.filename || attachment.name || 'attachment',
      contentType: attachment.contentType || 'application/octet-stream',
      contentBytes: Buffer.isBuffer(content)
        ? content.toString('base64')
        : Buffer.from(String(content)).toString('base64')
    };
    if (attachment.isInline || attachment.cid || attachment.contentId) {
      graphAttachment.isInline = true;
      graphAttachment.contentId = attachment.contentId || attachment.cid;
    }
    return graphAttachment;
  });
}

function attachmentBuffer(attachment = {}) {
  if (attachment.content === undefined || attachment.content === null) {
    throw new Error(`Microsoft Graph attachment "${attachment.filename || attachment.name || 'attachment'}" has no content`);
  }
  return Buffer.isBuffer(attachment.content) ? attachment.content : Buffer.from(String(attachment.content));
}

async function graphRequest(url, accessToken, options = {}, expectedStatuses = [200, 201, 202]) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.headers || {})
    }
  });
  if (!expectedStatuses.includes(response.status)) {
    throw new Error(await readGraphError(response, `Microsoft Graph request failed (${response.status})`));
  }
  return response;
}

async function sendMicrosoftGraphMailWithLargeAttachments({ config, accessToken, message, attachments }) {
  const graphUserUrl = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.senderEmail)}`;
  const draftResponse = await graphRequest(`${graphUserUrl}/messages`, accessToken, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(message)
  }, [201]);
  const draft = await draftResponse.json();
  if (!draft.id) throw new Error('Microsoft Graph did not return a draft message ID');

  for (const attachment of attachments) {
    const content = attachmentBuffer(attachment);
    const name = attachment.filename || attachment.name || 'attachment';
    const sessionResponse = await graphRequest(`${graphUserUrl}/messages/${encodeURIComponent(draft.id)}/attachments/createUploadSession`, accessToken, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        AttachmentItem: {
          attachmentType: 'file',
          name,
          size: content.length,
          contentType: attachment.contentType || 'application/octet-stream'
        }
      })
    }, [200, 201]);
    const session = await sessionResponse.json();
    if (!session.uploadUrl) throw new Error(`Microsoft Graph did not return an upload URL for "${name}"`);

    const chunkSize = 320 * 1024 * 10;
    for (let start = 0; start < content.length; start += chunkSize) {
      const end = Math.min(start + chunkSize, content.length) - 1;
      const chunk = content.subarray(start, end + 1);
      const uploadResponse = await fetch(session.uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Length': String(chunk.length),
          'Content-Range': `bytes ${start}-${end}/${content.length}`
        },
        body: chunk
      });
      if (![200, 201, 202].includes(uploadResponse.status)) {
        throw new Error(await readGraphError(uploadResponse, `Microsoft Graph attachment upload failed (${uploadResponse.status})`));
      }
    }
  }

  await graphRequest(`${graphUserUrl}/messages/${encodeURIComponent(draft.id)}/send`, accessToken, { method: 'POST' }, [202]);
  return draft.id;
}

async function sendMicrosoftGraphMail(recipients, subject, messageHtml, options = {}) {
  const config = readGraphConfig();
  const accessToken = await getGraphAccessToken(config);
  const replyTo = String(process.env.MAIL_REPLY_TO || config.senderEmail || '').trim();
  const rawAttachments = Array.isArray(options.attachments) ? options.attachments : [];
  const largeAttachments = rawAttachments.filter((attachment) => attachmentBuffer(attachment).length > 3 * 1024 * 1024);
  const inlineAttachments = rawAttachments.filter((attachment) => attachmentBuffer(attachment).length <= 3 * 1024 * 1024);
  const attachments = toGraphAttachments(inlineAttachments);
  const ccRecipients = normalizeRecipients(options.cc);
  const message = {
    subject: String(subject || ''),
    body: { contentType: 'HTML', content: messageHtml },
    toRecipients: toGraphRecipients(recipients)
  };
  if (ccRecipients.length) message.ccRecipients = toGraphRecipients(ccRecipients);
  if (replyTo) message.replyTo = toGraphRecipients([replyTo]);
  if (attachments.length) message.attachments = attachments;

  if (largeAttachments.length) {
    const draftId = await sendMicrosoftGraphMailWithLargeAttachments({ config, accessToken, message, attachments: largeAttachments });
    return {
      raw: { provider: 'microsoft-graph', status: 202, draftId, largeAttachmentUpload: true },
      summary: {
        provider: 'microsoft-graph',
        sender: config.senderEmail,
        accepted: recipients,
        rejected: [],
        response: 'Accepted by Microsoft Graph with large attachment upload'
      }
    };
  }

  const response = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.senderEmail)}/sendMail`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ message, saveToSentItems: true })
    }
  );

  if (!response.ok) {
    throw new Error(await readGraphError(response, `Microsoft Graph sendMail failed (${response.status})`));
  }

  return {
    raw: { provider: 'microsoft-graph', status: response.status },
    summary: {
      provider: 'microsoft-graph',
      sender: config.senderEmail,
      accepted: recipients,
      rejected: [],
      response: 'Accepted by Microsoft Graph'
    }
  };
}

async function sendSmtpMail(recipients, subject, messageHtml, options = {}) {
  const mailUser = readMailUser();
  if (!process.env.SMTP_HOST) throw new Error('SMTP_HOST is not configured');

  const from = formatFromAddress();
  const replyTo = process.env.MAIL_REPLY_TO || mailUser || undefined;
  const transporter = createTransporter();
  const cc = normalizeRecipients(options.cc);
  const info = await transporter.sendMail({ from, to: recipients, cc: cc.length ? cc : undefined, replyTo, subject, html: messageHtml, attachments: Array.isArray(options.attachments) ? options.attachments : undefined });
  return { raw: info, summary: summarizeMailInfo(info) };
}

async function sendMail(to, subject, html, options = {}) {
  const recipients = normalizeRecipients(to);
  if (!recipients.length) throw new Error('Email recipient is required');
  const messageHtml = options.branded === false ? String(html || '') : buildBrandedEmail(html);
  if (readMailProvider() === 'microsoft-graph') {
    return sendMicrosoftGraphMail(recipients, subject, messageHtml, options);
  }
  return sendSmtpMail(recipients, subject, messageHtml, options);
}

function resetGraphTokenCache() {
  graphTokenCache = { accessToken: '', expiresAt: 0, cacheKey: '' };
}

module.exports = {
  sendMail,
  getMailDebugConfig,
  summarizeMailInfo,
  buildBrandedEmail,
  resetGraphTokenCache
};
