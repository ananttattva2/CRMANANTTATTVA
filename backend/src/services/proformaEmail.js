const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const User = require('../models/User');
const { userHasAnyRole } = require('../utils/userRoles');

function emails(value, limit = 30) {
  const input = Array.isArray(value) ? value.join(',') : String(value || '');
  if (input.length > 8000) throw Object.assign(new Error('Too many email addresses.'), { status: 400 });
  const result = [...new Set(input.split(/[,;\s]+/).map(item => item.trim().toLowerCase()).filter(Boolean))];
  if (result.length > limit || result.some(item => item.length > 254 || !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(item))) {
    throw Object.assign(new Error(`Enter up to ${limit} valid email addresses, separated by commas.`), { status: 400 });
  }
  return result;
}
async function requiredCopies(invoice, actor) {
  const users = await User.find({ isActive: { $ne: false } }).select('email role roles team').lean();
  const internal = users.filter(user => userHasAnyRole(user, ['admin', 'superadmin', 'finance', 'accounts']) || /^(finance|accounts)$/i.test(String(user.team || '').trim()));
  return emails([...internal.map(user => user.email), invoice.createdBy?.email, actor.email].filter(Boolean), 200);
}
let renderer;
let rendererVersion;
async function invoicePdf(invoice) {
  const file = path.resolve(__dirname, '../../../frontend/src/utils/proformaPdf.js');
  const version = fs.statSync(file).mtimeMs;
  if (!renderer || rendererVersion !== version) {
    rendererVersion = version;
    const stamp = `data:image/png;base64,${fs.readFileSync(path.resolve(__dirname, '../../../frontend/src/assets/proforma-authorized-stamp.png'), 'base64')}`;
    const stampModule = `data:text/javascript,export%20default%20${encodeURIComponent(JSON.stringify(stamp))}`;
    const source = fs.readFileSync(file, 'utf8')
      .replace("from 'jspdf'", `from '${pathToFileURL(require.resolve('jspdf')).href}'`)
      .replace("from '../assets/proforma-authorized-stamp.png?inline'", `from '${stampModule}'`);
    renderer = import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`).catch(error => { renderer = null; throw error; });
  }
  const { buildInvoicePdf } = await renderer;
  return Buffer.from(buildInvoicePdf(invoice).output('arraybuffer'));
}
function validateMessage(body = {}) {
  const to = emails(body.to, 10), cc = emails(body.cc);
  const subject = String(body.subject || '').trim(), message = String(body.body || '').trim();
  if (!to.length || !subject || subject.length > 200 || /[\r\n]/.test(subject) || !message || message.length > 10000) {
    throw Object.assign(new Error('Enter To recipients, a subject (up to 200 characters), and a message (up to 10,000 characters).'), { status: 400 });
  }
  return { to, cc, subject, message };
}
module.exports = { emails, requiredCopies, invoicePdf, validateMessage };
