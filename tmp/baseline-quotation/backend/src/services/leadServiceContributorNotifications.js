const Notification = require('../models/Notification');
const PendingApproval = require('../models/PendingApproval');
const User = require('../models/User');
const { sendMail } = require('../utils/mailer');
const { ADMIN_ROLES } = require('../constants/roles');

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));
}

function clean(value) {
  return String(value || '').trim();
}

function identityTokens(...values) {
  return [...new Set(values.flatMap((value) => value && typeof value === 'object'
    ? [value._id, value.id, value.crmUserId, value.userId, value.email, value.name]
    : [value]).map((value) => clean(value).toLowerCase()).filter(Boolean))];
}

function serviceWasDelegatedToOriginalCreator({ beforeLead = {}, afterLead = {}, actor = {}, creator = {} }) {
  const originalTokens = identityTokens(
    creator,
    beforeLead.createdBy,
    beforeLead.createdByCrmUserId,
    beforeLead.createdByEmail,
    beforeLead.createdByName,
    beforeLead.importedCreatedBy
  );
  const selectedOwnerTokens = identityTokens(
    afterLead.generatedForUser,
    afterLead.generatedForName,
    afterLead.generatedForEmail
  );
  const actorTokens = identityTokens(actor);
  const selectedOriginalCreator = selectedOwnerTokens.some((token) => originalTokens.includes(token));
  const selectedActor = selectedOwnerTokens.some((token) => actorTokens.includes(token));
  return selectedOriginalCreator && !selectedActor;
}

function serviceSignature(row = {}) {
  return [
    row.industryType,
    row.eprCategory,
    row.applicantType,
    row.subApplicantType || row.piboCategory,
    row.servicesOffered,
    row.applicableService,
    row.firstAnnualReturnYearApplicable
  ].map((value) => clean(value).toLowerCase()).join('|');
}

function newlyAddedServices(beforeLead = {}, afterLead = {}) {
  const counts = new Map();
  (Array.isArray(beforeLead.serviceSelections) ? beforeLead.serviceSelections : []).forEach((row) => {
    const signature = serviceSignature(row);
    counts.set(signature, (counts.get(signature) || 0) + 1);
  });
  return (Array.isArray(afterLead.serviceSelections) ? afterLead.serviceSelections : []).filter((row) => {
    const signature = serviceSignature(row);
    const remaining = counts.get(signature) || 0;
    if (remaining > 0) {
      counts.set(signature, remaining - 1);
      return false;
    }
    return true;
  });
}

function ownerName(row = {}, lead = {}) {
  return clean(
    row.createdByName
    || row.createdByEmail
    || lead.importedCreatedBy
    || lead.createdByName
    || lead.createdByEmail
    || 'CRM User'
  );
}

function groupServicesByUser(lead = {}) {
  const groups = new Map();
  (Array.isArray(lead.serviceSelections) ? lead.serviceSelections : []).forEach((row) => {
    const owner = ownerName(row, lead);
    if (!groups.has(owner)) groups.set(owner, []);
    groups.get(owner).push(row);
  });
  return [...groups.entries()].map(([user, services]) => ({ user, services }));
}

async function resolveOriginalCreator(lead = {}) {
  const creatorId = clean(lead.createdByCrmUserId || lead.createdBy?._id || lead.createdBy);
  const email = clean(lead.createdByEmail || lead.createdBy?.email).toLowerCase();
  const name = clean(lead.importedCreatedBy || lead.createdByName || lead.createdBy?.name);
  const conditions = [];
  if (/^[a-f\d]{24}$/i.test(creatorId)) conditions.push({ _id: creatorId });
  if (email) conditions.push({ email });
  if (name) conditions.push({ name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') });
  return conditions.length
    ? User.findOne({ $or: conditions, isActive: { $ne: false } }).select('_id name email role').lean()
    : null;
}

async function notifyAdditionalLeadServices({ beforeLead, afterLead, actor }) {
  const addedServices = newlyAddedServices(beforeLead, afterLead);
  if (!addedServices.length) return { ok: false, reason: 'no_new_services' };

  const creator = await resolveOriginalCreator(beforeLead);
  const actorTokens = [actor?._id, actor?.id, actor?.email, actor?.name].map(clean).filter(Boolean);
  const creatorTokens = [
    creator?._id,
    creator?.email,
    creator?.name,
    beforeLead.createdByCrmUserId,
    beforeLead.createdByEmail,
    beforeLead.importedCreatedBy,
    beforeLead.createdByName
  ].map(clean).filter(Boolean);
  if (actorTokens.some((token) => creatorTokens.some((creatorToken) => creatorToken.toLowerCase() === token.toLowerCase()))) {
    return { ok: false, reason: 'original_creator_added_service' };
  }
  if (serviceWasDelegatedToOriginalCreator({ beforeLead, afterLead, actor, creator })) {
    return { ok: false, reason: 'service_delegated_to_original_creator' };
  }

  const admins = await User.find({
    role: { $in: ADMIN_ROLES },
    isActive: { $ne: false }
  }).select('_id name email role').lean();
  const recipientsByEmail = new Map();
  const fallbackCreatorEmail = clean(beforeLead.createdByEmail || beforeLead.createdBy?.email).toLowerCase();
  if (!creator && fallbackCreatorEmail) {
    recipientsByEmail.set(fallbackCreatorEmail, {
      name: clean(beforeLead.importedCreatedBy || beforeLead.createdByName || fallbackCreatorEmail),
      email: fallbackCreatorEmail
    });
  }
  [creator, ...admins].filter((user) => user?.email).forEach((user) => recipientsByEmail.set(user.email.toLowerCase(), user));
  const recipients = [...recipientsByEmail.values()];
  if (!recipients.length) return { ok: false, reason: 'no_recipients' };

  const leadId = clean(afterLead._id || afterLead.id || afterLead.sourceLeadId || afterLead.leadCode);
  const company = clean(afterLead.company || beforeLead.company || 'Company');
  const actorName = clean(actor?.name || actor?.email || 'A CRM user');
  const eventKey = `${leadId}:${clean(actor?._id || actor?.email)}:${addedServices.map(serviceSignature).sort().join('~')}`;
  const existing = await Notification.findOne({
    kind: 'lead_additional_services',
    'metadata.eventKey': eventKey
  }).lean();

  await PendingApproval.findOneAndUpdate(
    { type: 'lead_service', source: 'crm', sourceClientId: eventKey },
    {
      $set: {
        uniqueId: `SERVICE-${leadId || Date.now()}`,
        clientName: company,
        approvalStatus: 'PENDING',
        createdByName: actorName,
        requestDate: new Date().toISOString().slice(0, 10),
        requestTime: new Date().toTimeString().slice(0, 8),
        nextReminderAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        payload: {
          eventKey,
          leadId,
          company,
          contributorId: clean(actor?._id || actor?.id),
          contributorName: actorName,
          contributorEmail: clean(actor?.email),
          originalCreatorId: clean(creator?._id || beforeLead.createdByCrmUserId),
          originalCreator: clean(creator?.name || beforeLead.importedCreatedBy || beforeLead.createdByName),
          originalCreatorEmail: clean(creator?.email || beforeLead.createdByEmail),
          addedServices,
          preliminaryStatus: 'PENDING',
          finalStatus: 'PENDING'
        },
        remarks: 'Awaiting preliminary review by the original lead creator.'
      },
      $setOnInsert: { type: 'lead_service', source: 'crm', sourceClientId: eventKey }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  if (existing) return { ok: true, skipped: true, notificationId: existing._id };

  const groups = groupServicesByUser(afterLead);
  const summaryRows = groups.map((group) => `<tr>
    <td style="padding:11px;border-bottom:1px solid #e2e8f0;font-weight:700">${escapeHtml(group.user)}</td>
    <td style="padding:11px;border-bottom:1px solid #e2e8f0;text-align:center">${group.services.length}</td>
    <td style="padding:11px;border-bottom:1px solid #e2e8f0">${escapeHtml(group.services.map((row) => row.servicesOffered || row.applicableService || '-').join(', '))}</td>
  </tr>`).join('');
  const addedRows = addedServices.map((row) => `<tr>
    <td style="padding:10px;border-bottom:1px solid #e2e8f0">${escapeHtml(row.industryType || '-')}</td>
    <td style="padding:10px;border-bottom:1px solid #e2e8f0">${escapeHtml(row.eprCategory || '-')}</td>
    <td style="padding:10px;border-bottom:1px solid #e2e8f0">${escapeHtml(row.applicantType || row.subApplicantType || row.piboCategory || '-')}</td>
    <td style="padding:10px;border-bottom:1px solid #e2e8f0">${escapeHtml(row.servicesOffered || '-')}</td>
    <td style="padding:10px;border-bottom:1px solid #e2e8f0">${escapeHtml(row.applicableService || '-')}</td>
    <td style="padding:10px;border-bottom:1px solid #e2e8f0">${escapeHtml(row.firstAnnualReturnYearApplicable || '-')}</td>
  </tr>`).join('');
  const html = `<div style="font-family:Arial,sans-serif;color:#334155">
    <h2 style="margin-bottom:8px;color:#0f766e">Additional services were added to an existing lead</h2>
    <p><strong>${escapeHtml(actorName)}</strong> added ${addedServices.length} additional service${addedServices.length === 1 ? '' : 's'} to a lead originally generated by <strong>${escapeHtml(creator?.name || beforeLead.importedCreatedBy || 'the original creator')}</strong>.</p>
    <p><strong>Lead:</strong> ${escapeHtml(afterLead.leadCode || leadId || '-')} &nbsp; <strong>Company:</strong> ${escapeHtml(company)}</p>
    <h3 style="margin:22px 0 8px;color:#0f172a">Newly Added Services</h3>
    <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0">
      <thead><tr style="background:#ecfdf5;color:#065f46">
        <th style="padding:10px;text-align:left">Industry</th><th style="padding:10px;text-align:left">Service Category</th>
        <th style="padding:10px;text-align:left">Applicant Type</th><th style="padding:10px;text-align:left">Service</th>
        <th style="padding:10px;text-align:left">Applicable Service</th><th style="padding:10px;text-align:left">Financial Year</th>
      </tr></thead><tbody>${addedRows}</tbody>
    </table>
    <h3 style="margin:22px 0 8px;color:#0f172a">User-wise Service Summary</h3>
    <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0">
      <thead><tr style="background:#eff6ff;color:#1e3a8a">
        <th style="padding:11px;text-align:left">User</th><th style="padding:11px;text-align:center">Service Count</th><th style="padding:11px;text-align:left">Services</th>
      </tr></thead><tbody>${summaryRows}</tbody>
    </table>
    <p style="margin-top:18px;color:#64748b">This notification is sent regardless of whether the lead is currently open or closed.</p>
  </div>`;

  const notification = await Notification.create({
    title: 'Additional services added to your lead',
    description: `${actorName} added ${addedServices.length} additional service(s) to ${company}.`,
    tag: 'Lead Service Update',
    kind: 'lead_additional_services',
    createdBy: actor?._id,
    createdByName: actorName,
    audience: recipients.map((recipient) => recipient._id).filter(Boolean),
    visibleToRoles: ADMIN_ROLES,
    metadata: { eventKey, leadId, company, actorName, addedCount: addedServices.length, groups: groups.map((group) => ({ user: group.user, count: group.services.length })) }
  });
  notification.crmNotificationId = String(notification._id);
  await notification.save();

  const results = await Promise.allSettled(recipients.map((recipient) =>
    sendMail(recipient.email, `Additional Services Added - ${company}`, html, { branded: false })
  ));
  notification.metadata = {
    ...notification.metadata,
    emailSent: results.filter((result) => result.status === 'fulfilled').length,
    emailFailed: results.filter((result) => result.status === 'rejected').length
  };
  notification.markModified('metadata');
  await notification.save();
  return { ok: true, notificationId: notification._id };
}

module.exports = {
  groupServicesByUser,
  newlyAddedServices,
  notifyAdditionalLeadServices,
  serviceSignature,
  serviceWasDelegatedToOriginalCreator
};
