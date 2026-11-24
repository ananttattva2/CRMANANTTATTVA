const mongoose = require('mongoose');
const Client = require('../models/Client');

function populateClientQuery(query) {
  return query
    .populate('selectedLead', 'leadCode company status emails mobileNo1 piboCategory eprCategory addressLine1 addressLine2 addressLine3 state city pinCode contactPerson designation')
    .populate('adminControls.assignedTo', 'name email role avatarUrl')
    .populate('createdBy', 'name email role avatarUrl');
}

function createComplianceIntegrationController(ClientModel = Client) {
  return {
    async listClients(req, res) {
      const clients = await populateClientQuery(ClientModel.find({}))
        .sort({ createdAt: -1 })
        .lean();
      return res.json({ ok: true, source: 'crm', clients });
    },

    async getClient(req, res) {
      const id = String(req.params?.id || '').trim();
      if (!mongoose.Types.ObjectId.isValid(id)) return res.status(404).json({ message: 'Client not found' });
      const client = await populateClientQuery(ClientModel.findById(id)).lean();
      if (!client) return res.status(404).json({ message: 'Client not found' });
      return res.json({ ok: true, source: 'crm', client });
    }
  };
}

module.exports = { ...createComplianceIntegrationController(), createComplianceIntegrationController, populateClientQuery };
