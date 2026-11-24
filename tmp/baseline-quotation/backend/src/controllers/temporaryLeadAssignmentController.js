const Lead = require('../models/Lead');
const User = require('../models/User');
const PendingApproval = require('../models/PendingApproval');
const Notification = require('../models/Notification');
const { sendMail } = require('../utils/mailer');

const DAY_MS = 24 * 60 * 60 * 1000;
const cleanRole = (user) => String(user?.role || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
const userId = (user) => String(user?._id || user?.id || '').trim();

function assignmentRows(lead) {
  return Array.isArray(lead.assignments) ? lead.assignments.map((row) => ({ ...(row || {}) })) : [];
}

async function notify(users, title, description, kind, metadata) {
  const recipients = users.filter((user) => user?._id);
  if (!recipients.length) return;
  await Notification.create({ title, description, tag: 'Temporary Assignment', kind, audience: recipients.map((user) => user._id), visibleToRoles: ['manager', 'superadmin'], metadata });
  await Promise.allSettled(recipients.filter((user) => user.email).map((user) => sendMail(user.email, title, `<div style="font-family:Arial,sans-serif;color:#334155"><h2 style="color:#0f766e">${title}</h2><p>${description}</p><p>Open the CRM to review this request.</p><p>Regards,<br>IT Team</p>`, { branded: false })));
}

exports.requestTemporaryAssignment = async (req, res) => {
  if (!['manager', 'admin', 'superadmin'].includes(cleanRole(req.user))) return res.status(403).json({ error: 'Only a Manager, Admin, or Super Admin can request temporary assignment.' });
  const lead = await Lead.findById(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead not found.' });
  const rowIndex = Number(req.body?.rowIndex);
  const rows = assignmentRows(lead);
  if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= rows.length) return res.status(400).json({ error: 'Please select a valid assignment row.' });
  const row = rows[rowIndex];
  const requesterId = userId(req.user);
  const managerId = String(row.assignedTo?._id || row.assignedTo || '').trim();
  if (cleanRole(req.user) === 'manager' && managerId !== requesterId) return res.status(403).json({ error: 'Only the assigned Manager can request temporary access.' });

  const temporaryUser = await User.findOne({ _id: req.body?.temporaryUserId, isActive: { $ne: false } }).select('name email role');
  if (!temporaryUser) return res.status(400).json({ error: 'Please select an active temporary user.' });
  if (String(row.assignedStaff?._id || row.assignedStaff || '') === String(temporaryUser._id)) return res.status(400).json({ error: 'Temporary user must be different from the permanently assigned user.' });

  const days = Math.min(7, Math.max(1, Number(req.body?.days) || 7));
  const requestKey = `${lead._id}:${rowIndex}`;
  const payload = { leadId: String(lead._id), leadCode: lead.leadCode, rowIndex, managerId, managerName: req.user.name || req.user.email, managerEmail: req.user.email || '', permanentUserId: String(row.assignedStaff?._id || row.assignedStaff || ''), permanentUserName: row.assignedStaffText || '', temporaryUserId: String(temporaryUser._id), temporaryUserName: temporaryUser.name || temporaryUser.email, temporaryUserEmail: temporaryUser.email || '', requestedDays: days, reason: String(req.body?.reason || '').trim(), requestType: row.temporaryUser?.status === 'ACTIVE' ? 'EXTENSION' : 'INITIAL' };
  const approval = await PendingApproval.findOneAndUpdate(
    { type: 'lead_temporary', source: 'crm', sourceClientId: requestKey },
    { uniqueId: lead.leadCode || String(lead._id), clientName: lead.company, approvalStatus: 'PENDING', createdByName: req.user.name || req.user.email, requestDate: new Date().toLocaleDateString('en-GB'), requestTime: new Date().toLocaleTimeString('en-IN'), payload, nextReminderAt: new Date(Date.now() + DAY_MS), $unset: { actionAt: 1, actionBy: 1, remarks: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  row.temporaryUser = { ...payload, approvalId: String(approval._id), status: 'PENDING', requestedAt: new Date() };
  rows[rowIndex] = row;
  lead.assignments = rows;
  lead.markModified('assignments');
  await lead.save();
  const superAdmins = await User.find({ role: 'superadmin', isActive: { $ne: false } }).select('_id name email');
  await notify(superAdmins, `Temporary assignment approval: ${lead.company || lead.leadCode}`, `${payload.managerName} requested ${days}-day temporary access for ${payload.temporaryUserName}. Permanent ownership will remain unchanged.`, 'lead_temporary_assignment_request', { approvalId: String(approval._id), leadId: String(lead._id), rowIndex });
  res.status(201).json({ ok: true, approval, temporaryUser: row.temporaryUser });
};

exports.decideTemporaryAssignment = async (req, res) => {
  if (!['admin', 'superadmin'].includes(cleanRole(req.user))) return res.status(403).json({ error: 'Only an Admin or Super Admin can approve or reject temporary assignments.' });
  const decision = String(req.body?.decision || '').toUpperCase();
  if (!['APPROVED', 'REJECTED'].includes(decision)) return res.status(400).json({ error: 'Decision must be APPROVED or REJECTED.' });
  const remarks = String(req.body?.remarks || '').trim();
  const remarkWords = remarks ? remarks.split(/\s+/).filter(Boolean).length : 0;
  if (!remarks) return res.status(400).json({ error: 'Remarks are required for approval and rejection.' });
  if (remarkWords > 250) return res.status(400).json({ error: 'Remarks cannot exceed 250 words.' });
  const approval = await PendingApproval.findOne({ _id: req.params.approvalId, type: 'lead_temporary', approvalStatus: 'PENDING' });
  if (!approval) return res.status(404).json({ error: 'Pending temporary assignment request not found.' });
  const lead = await Lead.findById(approval.payload?.leadId);
  if (!lead) return res.status(404).json({ error: 'Lead not found.' });
  const rows = assignmentRows(lead);
  const rowIndex = Number(approval.payload?.rowIndex);
  if (!rows[rowIndex]) return res.status(409).json({ error: 'The assignment row no longer exists.' });
  const now = new Date();
  const expiresAt = new Date(now.getTime() + (Math.min(7, Math.max(1, Number(approval.payload?.requestedDays) || 7)) * DAY_MS));
  rows[rowIndex].temporaryUser = { ...approval.payload, approvalId: String(approval._id), status: decision === 'APPROVED' ? 'ACTIVE' : 'REJECTED', approvedAt: decision === 'APPROVED' ? now : undefined, expiresAt: decision === 'APPROVED' ? expiresAt : undefined, decidedAt: now, decisionRemarks: remarks, decidedById: String(req.user._id), decidedByName: req.user.name || req.user.email };
  lead.assignments = rows;
  lead.markModified('assignments');
  await lead.save();
  approval.approvalStatus = decision;
  approval.actionBy = req.user._id;
  approval.actionAt = now;
  approval.remarks = remarks;
  approval.nextReminderAt = null;
  await approval.save();
  const recipients = await User.find({ _id: { $in: [approval.payload?.managerId, approval.payload?.temporaryUserId].filter(Boolean) } }).select('_id name email');
  await notify(recipients, `Temporary assignment ${decision.toLowerCase()}: ${lead.company || lead.leadCode}`, decision === 'APPROVED' ? `${approval.payload.temporaryUserName} now has operational responsibility until ${expiresAt.toLocaleString('en-IN')}. The permanent assignee remains unchanged.` : `The request for ${approval.payload.temporaryUserName} was rejected.${approval.remarks ? ` Reason: ${approval.remarks}` : ''}`, 'lead_temporary_assignment_decision', { approvalId: String(approval._id), leadId: String(lead._id), rowIndex, decision, expiresAt });
  res.json({ ok: true, approval, temporaryUser: rows[rowIndex].temporaryUser });
};
