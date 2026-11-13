const test = require('node:test');
const assert = require('node:assert/strict');
const { sendMail, resetGraphTokenCache } = require('../src/utils/mailer');

const GRAPH_ENV_KEYS = [
  'MAIL_PROVIDER',
  'MS_TENANT_ID',
  'MS_CLIENT_ID',
  'MS_CLIENT_SECRET',
  'OTP_SENDER_EMAIL',
  'MAIL_REPLY_TO',
  'MAIL_HTTP_TIMEOUT_MS'
];

function withGraphEnvironment(run) {
  const previous = Object.fromEntries(GRAPH_ENV_KEYS.map((key) => [key, process.env[key]]));
  process.env.MAIL_PROVIDER = 'microsoft-graph';
  process.env.MS_TENANT_ID = 'tenant-id';
  process.env.MS_CLIENT_ID = 'client-id';
  process.env.MS_CLIENT_SECRET = 'test-secret';
  process.env.OTP_SENDER_EMAIL = 'crm@ananttattva.com';
  process.env.MAIL_REPLY_TO = 'crm@ananttattva.com';
  resetGraphTokenCache();

  return Promise.resolve()
    .then(run)
    .finally(() => {
      GRAPH_ENV_KEYS.forEach((key) => {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      });
      resetGraphTokenCache();
    });
}

test('all configured mail is sent through the Outlook mailbox using Microsoft Graph', async () => {
  await withGraphEnvironment(async () => {
    const previousFetch = global.fetch;
    const calls = [];
    global.fetch = async (url, options) => {
      calls.push({ url, options });
      if (String(url).includes('/oauth2/v2.0/token')) {
        return new Response(JSON.stringify({ access_token: 'token-value', expires_in: 3600 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(null, { status: 202 });
    };

    try {
      const result = await sendMail(
        ['sonal@example.com', 'shubham@example.com'],
        'Lead assigned',
        '<p>Please begin onboarding.</p>'
      );

      assert.equal(calls.length, 2);
      assert.match(calls[0].url, /login\.microsoftonline\.com\/tenant-id\/oauth2\/v2\.0\/token$/);
      assert.match(String(calls[0].options.body), /scope=https%3A%2F%2Fgraph\.microsoft\.com%2F\.default/);
      assert.equal(
        calls[1].url,
        'https://graph.microsoft.com/v1.0/users/crm%40ananttattva.com/sendMail'
      );
      assert.equal(calls[1].options.headers.Authorization, 'Bearer token-value');
      const payload = JSON.parse(calls[1].options.body);
      assert.deepEqual(
        payload.message.toRecipients.map((recipient) => recipient.emailAddress.address),
        ['sonal@example.com', 'shubham@example.com']
      );
      assert.equal(payload.message.body.contentType, 'HTML');
      assert.equal(payload.saveToSentItems, true);
      assert.equal(result.summary.provider, 'microsoft-graph');
      assert.equal(result.summary.sender, 'crm@ananttattva.com');
    } finally {
      global.fetch = previousFetch;
    }
  });
});

test('Microsoft Graph access token is reused until it nears expiry', async () => {
  await withGraphEnvironment(async () => {
    const previousFetch = global.fetch;
    let tokenRequests = 0;
    let mailRequests = 0;
    global.fetch = async (url) => {
      if (String(url).includes('/oauth2/v2.0/token')) {
        tokenRequests += 1;
        return new Response(JSON.stringify({ access_token: 'cached-token', expires_in: 3600 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      mailRequests += 1;
      return new Response(null, { status: 202 });
    };

    try {
      await sendMail('first@example.com', 'First', '<p>First</p>');
      await sendMail('second@example.com', 'Second', '<p>Second</p>');
      assert.equal(tokenRequests, 1);
      assert.equal(mailRequests, 2);
    } finally {
      global.fetch = previousFetch;
    }
  });
});

test('Microsoft Graph preserves inline CID image metadata', async () => {
  await withGraphEnvironment(async () => {
    const previousFetch = global.fetch;
    const calls = [];
    global.fetch = async (url, options) => {
      calls.push({ url: String(url), options });
      if (String(url).includes('/oauth2/v2.0/token')) {
        return new Response(JSON.stringify({ access_token: 'inline-token', expires_in: 3600 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(null, { status: 202 });
    };

    try {
      await sendMail('customer@example.com', 'Inline logo', '<img src="cid:company-logo" />', {
        branded: false,
        attachments: [{ filename: 'logo.png', contentType: 'image/png', content: Buffer.from('png'), cid: 'company-logo', isInline: true }]
      });
      const payload = JSON.parse(calls[1].options.body);
      const attachment = payload.message.attachments[0];
      assert.equal(attachment.isInline, true);
      assert.equal(attachment.contentId, 'company-logo');
    } finally {
      global.fetch = previousFetch;
    }
  });
});

test('large PDF attachments use a Microsoft Graph upload session before sending', async () => {
  await withGraphEnvironment(async () => {
    const previousFetch = global.fetch;
    const calls = [];
    global.fetch = async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url).includes('/oauth2/v2.0/token')) {
        return new Response(JSON.stringify({ access_token: 'large-token', expires_in: 3600 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (String(url).endsWith('/messages')) {
        return new Response(JSON.stringify({ id: 'draft-123' }), { status: 201, headers: { 'Content-Type': 'application/json' } });
      }
      if (String(url).endsWith('/attachments/createUploadSession')) {
        return new Response(JSON.stringify({ uploadUrl: 'https://upload.example/session' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (String(url) === 'https://upload.example/session') {
        const range = options.headers['Content-Range'];
        return new Response(null, { status: range.includes('/5728035') && range.startsWith('bytes 3276800-') ? 201 : 202 });
      }
      if (String(url).endsWith('/messages/draft-123/send')) return new Response(null, { status: 202 });
      throw new Error(`Unexpected Graph request: ${url}`);
    };

    try {
      const result = await sendMail('admin@example.com', 'Company profile', '<p>Attached</p>', {
        branded: false,
        attachments: [{ filename: 'profile.pdf', contentType: 'application/pdf', content: Buffer.alloc(5728035, 1) }]
      });
      assert.equal(calls.filter((call) => call.url === 'https://upload.example/session').length, 2);
      assert.ok(calls.some((call) => call.url.endsWith('/messages/draft-123/send')));
      assert.equal(result.raw.largeAttachmentUpload, true);
    } finally {
      global.fetch = previousFetch;
    }
  });
});

test('mixed-size PDFs keep the small attachment inline and upload only the large attachment', async () => {
  await withGraphEnvironment(async () => {
    const previousFetch = global.fetch;
    const calls = [];
    global.fetch = async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url).includes('/oauth2/v2.0/token')) return new Response(JSON.stringify({ access_token: 'mixed-token', expires_in: 3600 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (String(url).endsWith('/messages')) return new Response(JSON.stringify({ id: 'draft-mixed' }), { status: 201, headers: { 'Content-Type': 'application/json' } });
      if (String(url).endsWith('/attachments/createUploadSession')) return new Response(JSON.stringify({ uploadUrl: 'https://upload.example/mixed' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (String(url) === 'https://upload.example/mixed') return new Response(null, { status: 201 });
      if (String(url).endsWith('/messages/draft-mixed/send')) return new Response(null, { status: 202 });
      throw new Error(`Unexpected Graph request: ${url}`);
    };

    try {
      await sendMail('customer@example.com', 'Introduction', '<p>Attached</p>', {
        branded: false,
        attachments: [
          { filename: 'small.pdf', contentType: 'application/pdf', content: Buffer.alloc(100_000, 1) },
          { filename: 'large.pdf', contentType: 'application/pdf', content: Buffer.alloc(4_000_000, 1) }
        ]
      });
      const draftCall = calls.find((call) => call.url.endsWith('/messages'));
      const draftMessage = JSON.parse(draftCall.options.body);
      assert.deepEqual(draftMessage.attachments.map((attachment) => attachment.name), ['small.pdf']);
      assert.equal(calls.filter((call) => call.url.endsWith('/attachments/createUploadSession')).length, 1);
    } finally {
      global.fetch = previousFetch;
    }
  });
});

test('a stalled Microsoft Graph call fails as a bounded timeout instead of hanging the request', async () => {
  await withGraphEnvironment(async () => {
    const previousFetch = global.fetch;
    process.env.MAIL_HTTP_TIMEOUT_MS = '25';
    global.fetch = (url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason));
    });
    // AbortSignal.timeout uses an unref'd timer, so keep the loop alive long
    // enough for it to fire in this isolated test.
    const keepAlive = setTimeout(() => {}, 500);

    try {
      await assert.rejects(
        () => sendMail('stalled@example.com', 'Stalled', '<p>Stalled</p>'),
        (error) => error.code === 'MAIL_PROVIDER_TIMEOUT' && /timed out after 25ms/.test(error.message)
      );
    } finally {
      global.fetch = previousFetch;
      clearTimeout(keepAlive);
    }
  });
});
