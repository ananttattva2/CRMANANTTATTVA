const HealthReportAssignment = require('../models/HealthReportAssignment');
const Lead = require('../models/Lead');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { sendMail } = require('../utils/mailer');

const MANAGER_ROLES = ['manager'];
const ADMIN_ROLES = ['admin', 'superadmin'];
const normalizeRole = (value) => String(value || '').trim().toLowerCase();

function assignmentQuery(user) {
  const role = normalizeRole(user?.role);
  if (ADMIN_ROLES.includes(role)) return {};
  if (MANAGER_ROLES.includes(role)) return { manager: user._id };
  return { assignedUser: user._id };
}

exports.listAssignments = async (req, res) => {
  const assignments = await HealthReportAssignment.find(assignmentQuery(req.user))
    .populate('lead', 'leadCode company mobileNo1 complianceHealthReport')
    .populate('manager assignedUser requestedBy', 'name email role')
    .sort({ createdAt: -1 }).lean();
  res.json({ ok: true, assignments });
};

exports.createAssignment = async (req, res) => {
  const lead = await Lead.findById(req.body.leadId);
  if (!lead) return res.status(404).json({ error: 'Lead not found' });
  const manager = await User.findOne({ _id: req.body.managerId, role: 'manager', isActive: { $ne: false } });
  if (!manager) return res.status(400).json({ error: 'Please select an active Manager' });

  const assignment = await HealthReportAssignment.findOneAndUpdate(
    { lead: lead._id },
    { lead: lead._id, companyName: lead.company || 'Untitled company', leadCode: lead.leadCode || '', requestedBy: req.user._id, manager: manager._id, assignedUser: null, status: 'MANAGER_REVIEW' },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  const description = `A Compliance Health Report check for ${lead.company || lead.leadCode} is assigned to you. Please review it and select a user so work can begin.`;
  await Notification.create({ title: 'Compliance Health Report check required', description, tag: 'Health Report', kind: 'health_report_assignment', audience: [manager._id], createdBy: req.user._id, createdByName: req.user.name || req.user.email, metadata: { assignmentId: assignment._id, leadId: lead._id } });
  await sendMail(manager.email, `Compliance Health Report check: ${lead.company || lead.leadCode}`, `<p>Hello ${manager.name || 'Manager'},</p><p>${description}</p><p>Please open <strong>Health Report Check</strong> in CRM and assign a user.</p><p>Regards,<br>IT Team</p>`).catch((error) => console.error('Health report manager email failed', error));
  res.status(201).json({ ok: true, assignment });
};

exports.assignUser = async (req, res) => {
  const assignment = await HealthReportAssignment.findById(req.params.id);
  if (!assignment) return res.status(404).json({ error: 'Health Report assignment not found' });
  const role = normalizeRole(req.user?.role);
  if (!ADMIN_ROLES.includes(role) && (role !== 'manager' || String(assignment.manager) !== String(req.user._id))) return res.status(403).json({ error: 'Only the selected Manager can assign this Health Report' });
  const user = await User.findOne({ _id: req.body.userId, isActive: { $ne: false }, role: { $nin: ['manager', 'admin', 'superadmin'] } });
  if (!user) return res.status(400).json({ error: 'Please select an active CRM user' });
  assignment.assignedUser = user._id;
  assignment.assignedAt = new Date();
  assignment.status = 'ASSIGNED';
  await assignment.save();
  await Notification.create({ title: 'Compliance Health Report assigned', description: `${assignment.companyName} is ready for your Compliance Health Report check.`, tag: 'Health Report', kind: 'health_report_assignment', audience: [user._id], createdBy: req.user._id, createdByName: req.user.name || req.user.email, metadata: { assignmentId: assignment._id, leadId: assignment.lead } });
  res.json({ ok: true, assignment });
};

exports.__test = { assignmentQuery };
