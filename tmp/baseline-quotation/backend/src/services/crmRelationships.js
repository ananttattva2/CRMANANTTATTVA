const mongoose = require('mongoose');
const Lead = require('../models/Lead');
const Client = require('../models/Client');
const { normalizeCompanyIdentity } = require('./crmRecordPersistence');

function text(value) {
  return String(value || '').trim();
}

async function resolveCrmRelationships({ leadId, companyName } = {}) {
  const identity = text(leadId);
  const companyIdentity = normalizeCompanyIdentity(companyName);
  const leadFilters = [];
  const clientFilters = [];

  if (identity) {
    leadFilters.push(
      { sourceLeadId: identity },
      { externalLeadId: identity },
      { leadCode: identity }
    );
    clientFilters.push(
      { 'data.importMeta.uniqueId': identity },
      { 'data.importMeta.leadNumber': identity }
    );
    if (mongoose.Types.ObjectId.isValid(identity)) {
      leadFilters.unshift({ _id: identity });
      clientFilters.unshift({ _id: identity }, { selectedLead: identity });
    }
  }
  if (companyIdentity) {
    leadFilters.push({ companyIdentity });
    clientFilters.push({ companyIdentity });
  }

  let [lead, client] = await Promise.all([
    leadFilters.length ? Lead.findOne({ $or: leadFilters }).select('_id').lean() : null,
    clientFilters.length ? Client.findOne({ $or: clientFilters }).select('_id selectedLead').lean() : null
  ]);
  if (!lead && client?.selectedLead) lead = { _id: client.selectedLead };

  return {
    ...(lead?._id ? { leadRef: lead._id } : {}),
    ...(client?._id ? { clientRef: client._id } : {})
  };
}

module.exports = { resolveCrmRelationships };
