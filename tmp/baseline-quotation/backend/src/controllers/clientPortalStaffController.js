const Lead = require('../models/Lead');
const Upload = require('../models/ClientPortalUpload');
const Client = require('../models/Client');
const { uploadWorkflows } = require('../services/clientPortalUploadStages');
const { getVisibleUserScope, ownerFilter } = require('../utils/visibilityScope');
function uploadLeadFilter(scope) {
  return ownerFilter(scope, 'createdBy', 'assignedTo', [
    'createdByName', 'createdByEmail', 'generatedForName', 'generatedForEmail', 'closedByText', 'closedByEmail', 'closedOnBehalfOfEmail',
    'assignedStaffText', 'assignedStaffEmail', 'assignments.assignedStaffText', 'assignments.assignedStaffEmail', 'assignments.closedByText', 'assignments.closedByEmail',
    'serviceSelections.closedByText', 'serviceSelections.closedByEmail'
  ], ['generatedForUser', 'assignedStaff', 'closedBy', 'closedOnBehalfOfUser', 'assignments.assignedStaff', 'assignments.assignedTo', 'assignments.closedBy', 'serviceSelections.closedBy']);
}
exports.list = async (req, res) => {
  try {
    const scope = await getVisibleUserScope(req.user);
    const leadFilter = uploadLeadFilter(scope);
    const assignedClients = scope === null ? [] : await Client.find(ownerFilter(scope, 'createdBy', 'adminControls.assignedTo', ['data.importMeta.assignedTo', 'data.importMeta.userEmail', 'data.importMeta.createdByEmail'])).select('selectedLead').lean();
    const assignedLeads = assignedClients.map(client => client.selectedLead).filter(Boolean);
    const visible = await Lead.find(assignedLeads.length ? { $or: [leadFilter, { _id: { $in: assignedLeads } }] } : leadFilter).select('_id company leadCode serviceSelections assignments applicantType subApplicantType closedAt closedBy').lean();
    const page = Math.max(1, Math.min(100000, Number.parseInt(req.query.page, 10) || 1));
    const term = String(req.query.q || '').trim().slice(0, 120);
    const filter = { kind: 'excel', lead: { $in: visible.map(row => row._id) } };
    if (term) {
      const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ lead: { $in: visible.filter(row => regex.test(row.company || '') || regex.test(row.leadCode || '')).map(row => row._id) } }, { applicantType: regex }, { name: regex }];
    }
    const [total, rows] = await Promise.all([Upload.countDocuments(filter), Upload.find(filter).sort({ createdAt: -1 }).skip((page - 1) * 25).limit(25).select('lead applicantType name url size uploadedBy createdAt notificationStatus').lean()]);
    const workflows = await uploadWorkflows(rows, visible);
    const companies = new Map(visible.map(row => [String(row._id), row]));
    return res.json({ total, page, pages: Math.max(1, Math.ceil(total / 25)), rows: rows.map(row => ({ ...row, workflows: workflows.get(String(row._id)) || [], company: companies.get(String(row.lead))?.company || 'Client company', leadCode: companies.get(String(row.lead))?.leadCode || '' })) });
  } catch { return res.status(503).json({ error: 'Client uploads could not be loaded. Please retry.' }); }
};
exports.uploadLeadFilter = uploadLeadFilter;
