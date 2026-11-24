const LeadAssignmentOverride = require('../models/LeadAssignmentOverride');

function cleanKey(value) {
  return String(value || '').trim();
}

function leadKeys(lead = {}) {
  return [...new Set([
    lead._id,
    lead.id,
    lead.sourceLeadId,
    lead.externalLeadId,
    lead.leadId
  ].map(cleanKey).filter(Boolean))];
}

async function saveLeadAssignments(leadKey, assignments, user = {}) {
  const key = cleanKey(leadKey);
  if (!key || !Array.isArray(assignments)) return null;

  return LeadAssignmentOverride.findOneAndUpdate(
    { leadKey: key },
    {
      $set: {
        assignments,
        updatedBy: user._id || user.id,
        updatedByName: user.name || user.email || '',
        updatedByEmail: user.email || ''
      }
    },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
  ).lean();
}

async function saveLeadServiceSelections(leadKey, serviceSelections, user = {}) {
  const key = cleanKey(leadKey);
  if (!key || !Array.isArray(serviceSelections)) return null;

  return LeadAssignmentOverride.findOneAndUpdate(
    { leadKey: key },
    {
      $set: {
        serviceSelections,
        updatedBy: user._id || user.id,
        updatedByName: user.name || user.email || '',
        updatedByEmail: user.email || ''
      }
    },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
  ).lean();
}

function mergeAssignmentOverrides(rows = [], overrides = []) {
  const overrideByKey = new Map();
  overrides.forEach((override) => {
    const key = cleanKey(override?.leadKey);
    if (key) overrideByKey.set(key, override);
  });

  return rows.map((lead) => {
    const override = leadKeys(lead).map((key) => overrideByKey.get(key)).find(Boolean);
    if (!override) return lead;
    const hasAssignments = Array.isArray(override.assignments);
    const hasServiceSelections = Array.isArray(override.serviceSelections);
    if (!hasAssignments && !hasServiceSelections) return lead;
    const assignments = hasAssignments ? override.assignments.map((row) => ({ ...row })) : lead.assignments;
    const serviceSelections = hasServiceSelections ? override.serviceSelections.map((row) => ({ ...row })) : lead.serviceSelections;
    return {
      ...lead,
      ...(hasAssignments ? {
        assignments,
        assignedStaff: assignments[0]?.assignedStaff || '',
        assignedStaffText: assignments[0]?.assignedStaffText || '',
        assignedStaffEmail: assignments[0]?.assignedStaffEmail || ''
      } : {}),
      ...(hasServiceSelections ? {
        serviceSelections,
        industryType: serviceSelections[0]?.industryType || '',
        eprCategory: serviceSelections[0]?.eprCategory || '',
        applicantType: serviceSelections[0]?.applicantType || '',
        piboCategory: serviceSelections[0]?.subApplicantType || serviceSelections[0]?.piboCategory || '',
        servicesOffered: serviceSelections[0]?.servicesOffered || '',
        firstAnnualReturnYearApplicable: serviceSelections[0]?.firstAnnualReturnYearApplicable || ''
      } : {})
    };
  });
}

async function applySavedLeadAssignments(rows = []) {
  const keys = [...new Set(rows.flatMap(leadKeys))];
  if (!keys.length) return rows;
  const overrides = await LeadAssignmentOverride.find({ leadKey: { $in: keys } }).lean();
  return mergeAssignmentOverrides(rows, overrides);
}

async function appendLeadActivity(leadKey, event = {}) {
  const key = cleanKey(leadKey);
  if (!key) return null;
  return LeadAssignmentOverride.findOneAndUpdate(
    { leadKey: key },
    { $push: { activityLog: { ...event, id: event.id || `crm-${Date.now()}`, at: event.at || new Date() } } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();
}

async function getLeadActivities(leadKey) {
  const record = await LeadAssignmentOverride.findOne({ leadKey: cleanKey(leadKey) }).select('activityLog').lean();
  return Array.isArray(record?.activityLog) ? record.activityLog : [];
}

module.exports = {
  applySavedLeadAssignments,
  appendLeadActivity,
  getLeadActivities,
  leadKeys,
  mergeAssignmentOverrides,
  saveLeadAssignments,
  saveLeadServiceSelections
};
