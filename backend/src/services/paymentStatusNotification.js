const Notification = require('../models/Notification');
const User = require('../models/User');
const { userHasAnyRole } = require('../utils/userRoles');

async function notifyPaymentStatus({ approval, lead, paymentStatus, poAmount }, actor) {
  const users = await User.find({ isActive: { $ne: false } }).select('_id role roles').lean();
  const audience = users.filter(user => userHasAnyRole(user, ['admin', 'superadmin'])).map(user => user._id);
  if (!audience.length) return { skipped: true };
  const complete = paymentStatus.status === 'COMPLETE_RECEIVED';
  const amount = Number(paymentStatus.amount).toLocaleString('en-IN', { style: 'currency', currency: 'INR' });
  const date = new Date(paymentStatus.at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const company = lead.company || approval.clientName || lead.leadCode;
  return Notification.create({
    title: `${complete ? 'Complete' : 'Advance'} payment received · ${company}`,
    description: `${amount} received against PO total ${Number(poAmount).toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}. Updated by ${paymentStatus.name} on ${date} IST.${paymentStatus.remarks ? ` Remarks: ${paymentStatus.remarks}` : ''}`,
    tag: 'Payment', kind: 'workflow', audience, visibleToRoles: [],
    createdBy: actor._id, createdByName: actor.name || actor.email,
    metadata: { type: 'payment_status', approvalId: String(approval._id), leadCode: lead.leadCode, paymentStatus, poAmount, actionUrl: '/finance-approval' }
  });
}
module.exports = { notifyPaymentStatus };
