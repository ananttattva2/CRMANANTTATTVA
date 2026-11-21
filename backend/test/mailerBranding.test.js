const test = require('node:test');
const assert = require('node:assert/strict');
const { buildBrandedEmail } = require('../src/utils/mailer');

test('mailer does not inject a company logo into complete HTML emails', () => {
  const output = buildBrandedEmail('<html><body><h1>OTP</h1></body></html>');
  assert.doesNotMatch(output, /<img|logo|data-crm-mail-brand/i);
  assert.match(output, /<h1>OTP/);
});

test('mailer wraps HTML fragments without adding an image header', () => {
  const once = buildBrandedEmail('<p>Approval pending</p>');
  assert.doesNotMatch(once, /<img|logo|data-crm-mail-brand/i);
  assert.match(once, /Approval pending/);
});

test('Legal sender display name uses the configured CRM address in Graph', async t => {
  const mailer = require('../src/utils/mailer');
  const keys = ['MAIL_PROVIDER','MS_TENANT_ID','MS_CLIENT_ID','MS_CLIENT_SECRET','OTP_SENDER_EMAIL'];
  const previous = Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  t.after(()=>{ for(const key of keys) previous[key] === undefined ? delete process.env[key] : process.env[key]=previous[key]; mailer.resetGraphTokenCache(); });
  Object.assign(process.env,{MAIL_PROVIDER:'graph',MS_TENANT_ID:'test-tenant',MS_CLIENT_ID:'test-client',MS_CLIENT_SECRET:'test-secret',OTP_SENDER_EMAIL:'crm@example.test'});
  mailer.resetGraphTokenCache();
  let body;
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    if(String(url).includes('oauth2')) return new Response(JSON.stringify({access_token:'test-token',expires_in:3600}),{status:200});
    body=JSON.parse(options.body); return new Response(null,{status:202});
  });
  await mailer.sendMail('legal@example.test','Legal list','<p>List</p>',{fromName:'Krishna Yadav'});
  assert.deepEqual(body.message.from.emailAddress,{address:'crm@example.test',name:'Krishna Yadav'});
  assert.equal(body.saveToSentItems,true);
});
test('SMTP sender name override keeps the configured CRM mailbox', async t => {
  const nodemailer = require('nodemailer');
  const mailer = require('../src/utils/mailer');
  const keys=['MAIL_PROVIDER','SMTP_HOST','MAIL_FROM','SMTP_USER'];
  const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  t.after(()=>{for(const key of keys) previous[key] === undefined ? delete process.env[key] : process.env[key]=previous[key];});
  Object.assign(process.env,{MAIL_PROVIDER:'smtp',SMTP_HOST:'smtp.example.test',MAIL_FROM:'CRM <crm@example.test>',SMTP_USER:'crm@example.test'});
  let message;
  t.mock.method(nodemailer,'createTransport',()=>({sendMail:async options=>{message=options;return{accepted:['legal@example.test'],rejected:[]};}}));
  await mailer.sendMail('legal@example.test','List','<p>List</p>',{fromName:'Krishna Yadav'});
  assert.equal(message.from, '"Krishna Yadav" <crm@example.test>');
});
