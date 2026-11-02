const Lead = require('../models/Lead');
const User = require('../models/User');

const leadCodePattern = /^(?:ATPL-LEAD-|ATPL-)?0*409$/i;

async function correctTataMotorsLeadCreator() {
  const lead = await Lead.findOne({
    company: /^TATA MOTORS LIMITED$/i,
    $or: [{ leadCode: leadCodePattern }, { sourceLeadId: leadCodePattern }, { externalLeadId: leadCodePattern }]
  });
  if (!lead) return { updated: false, reason: 'lead_not_found' };

  const creator = await User.findOne({ name: /^GAURAV CHANDRA$/i, isActive: { $ne: false } }).select('_id name email').lean();
  if (!creator) return { updated: false, reason: 'creator_not_found' };
  if (String(lead.createdBy || '') === String(creator._id)
    && String(lead.createdByName || '').toUpperCase() === 'GAURAV CHANDRA') {
    return { updated: false, reason: 'already_correct' };
  }

  lead.createdBy = creator._id;
  lead.createdByCrmUserId = String(creator._id);
  lead.createdByName = creator.name;
  lead.createdByEmail = String(creator.email || '').toLowerCase();
  lead.importedCreatedBy = creator.name;
  await lead.save();
  return { updated: true, leadCode: lead.leadCode, company: lead.company, createdBy: creator.name };
}

const LEAD_OWNER_CORRECTIONS = [
  { company: /^BOSCH HOME COMFORT$/i, owner: /^GAURAV CHANDRA$/i },
  { company: /^ACTIONWARE INDIA PVT\.?\s+LTD\.?$/i, owner: /^RITUL BHUVA$/i },
  { company: /^SINTEX INDUSTRIES LTD\.?$/i, owner: /^MIHIRDEVSINH ZALA$/i },
  { company: /^TDS LITHIUM-ION BATTERY GUJARAT PRIVATE LIMITED$/i, owner: /^GAURAV CHANDRA$/i }
];

async function correctKnownLeadOwners() {
  const results = [];
  for (const correction of LEAD_OWNER_CORRECTIONS) {
    const owner = await User.findOne({ name: correction.owner, isActive: { $ne: false } }).select('_id name email').lean();
    if (!owner) { results.push({ updated: false, reason: 'owner_not_found', owner: String(correction.owner) }); continue; }
    const result = await Lead.updateMany({ company: correction.company, $or: [
      { generatedForUser: { $ne: owner._id } },
      { generatedForUser: { $exists: false } },
      { generatedForUser: null }
    ] }, { $set: {
      generatedForUser: owner._id,
      generatedForName: owner.name,
      generatedForEmail: String(owner.email || '').toLowerCase(),
      createdOnBehalfOfUser: owner._id,
      createdOnBehalfOfName: owner.name,
      createdOnBehalfOfEmail: String(owner.email || '').toLowerCase()
    } });
    results.push({ updated: result.modifiedCount > 0, count: result.modifiedCount, owner: owner.name });
  }
  return results;
}

async function applyKnownDataCorrections() {
  const creatorResult = await correctTataMotorsLeadCreator();
  const ownerResults = await correctKnownLeadOwners();
  if (creatorResult.updated || ownerResults.some((result) => result.updated)) console.log('Applied guarded CRM data correction', { creatorResult, ownerResults });
  return { creatorResult, ownerResults };
}

module.exports = { applyKnownDataCorrections, correctTataMotorsLeadCreator, correctKnownLeadOwners, LEAD_OWNER_CORRECTIONS };
