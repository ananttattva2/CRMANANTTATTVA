// One-service, reversible PO reset. Logs contain counts only.
const { createRequire } = require('node:module');
const path = require('node:path');
const fs = require('node:fs/promises');
const root = path.resolve(process.argv[2] || '.');
const operation = process.argv[3] || 'preview';
if (!['preview', 'apply'].includes(operation)) throw new Error('Invalid operation');
const appRequire = createRequire(path.join(root, 'backend/package.json'));
appRequire('dotenv').config({ path: path.join(root, 'backend/.env'), quiet: true });
const mongoose = appRequire('mongoose');
const { EJSON } = appRequire('bson');
const normalized = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const poKeys = assignment => Object.keys(assignment).filter(key => /^po[A-Z]|^originalPo/.test(key));
(async () => {
  try {
    const config = appRequire('./src/config/mongoConfig').mongoConfig();
    await mongoose.connect(config.uri, { dbName: config.dbName, autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 15000 });
    const leads = mongoose.connection.db.collection('leads');
    const approvals = mongoose.connection.db.collection('pendingapprovals');
    const matches = await leads.find({ leadCode: 'ATPL-LEAD-0587', deletedAt: null }).toArray();
    if (matches.length !== 1) throw new Error('Lead identity is ambiguous');
    const lead = matches[0], service = lead.serviceSelections?.[0], assignment = lead.assignments?.[0];
    if (!service || !assignment || normalized(service.servicesOffered || service.applicableService) !== 'newregistration'
      || normalized(service.subApplicantType || service.piboCategory) !== 'producer') throw new Error('Service identity mismatch');
    const serviceId = String(service.assignedServiceId || assignment.assignedServiceId || '');
    if (!serviceId || (service.assignedServiceId && assignment.assignedServiceId && String(service.assignedServiceId) !== String(assignment.assignedServiceId))) throw new Error('Assignment identity mismatch');
    const sourceId = `${lead._id}:po:${serviceId}`;
    const linked = await approvals.find({ type: 'purchase_order', deletedAt: null, $or: [
      { sourceClientId: sourceId },
      { 'payload.leadId': String(lead._id), 'payload.assignedServiceId': serviceId },
      { 'payload.leadId': String(lead._id), 'payload.assignmentIndex': 0 }
    ] }).toArray();
    if (linked.some(row => row.payload?.assignedServiceId && String(row.payload.assignedServiceId) !== serviceId)) throw new Error('Approval identity mismatch');
    const rows = assignment.poYearRows || [];
    const alreadyClear = !rows.length && !assignment.originalPoDetails && !assignment.poStatus && !linked.length;
    if (!alreadyClear && (rows.length !== 1 || String(rows[0].poNumber || '').trim() !== 'AT/26-27/414')) throw new Error('PO changed since screenshot');
    console.log(JSON.stringify({ check: 'scoped-po-reset-preview', targetServices: 1, poRows: rows.length, linkedApprovals: linked.length, alreadyClear }));
    if (operation === 'preview' || alreadyClear) return;
    const dir = path.join(root, '.po-reset-backups');
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const backupFile = path.join(dir, `0587-registration-${Date.now()}.json`);
    await fs.writeFile(backupFile, EJSON.stringify({ lead, approvals: linked }), { flag: 'wx', mode: 0o600 });
    const now = new Date(), unset = {};
    for (const key of poKeys(assignment)) unset[`assignments.0.${key}`] = '';
    // Closure based on the removed PO must be resubmitted with the new PO.
    for (const key of ['closedAt', 'closedBy', 'closedByText', 'closureRequestedBy', 'closureRequestedByText', 'closureFinalizedByManager', 'permanentClosedAt', 'permanentClosedBy', 'permanentClosedByText', 'provisionalCloseExpiresAt', 'provisionalCloseDeadlineBusinessDays']) {
      if (Object.hasOwn(assignment, key)) unset[`assignments.0.${key}`] = '';
    }
    delete unset['assignments.0.poYearRows'];
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const changed = await leads.updateOne({ _id: lead._id, updatedAt: lead.updatedAt }, {
          $unset: unset, $set: { 'assignments.0.poYearRows': [], updatedAt: now }
        }, { session });
        if (changed.modifiedCount !== 1) throw new Error('Concurrent lead update');
        for (const approval of linked) {
          const changedApproval = await approvals.updateOne({ _id: approval._id, updatedAt: approval.updatedAt, deletedAt: null }, {
            $set: { deletedAt: now, updatedAt: now, 'payload.resetReason': 'User requested clearing Service 1 PO details; backup retained.' }
          }, { session });
          if (changedApproval.modifiedCount !== 1) throw new Error('Concurrent approval update');
        }
      });
    } finally { await session.endSession(); }
    const after = await leads.findOne({ _id: lead._id });
    if (after.assignments[0].poYearRows.length || poKeys(after.assignments[0]).some(key => key !== 'poYearRows')) throw new Error('PO reset verification failed');
    if (EJSON.stringify(after.assignments.slice(1)) !== EJSON.stringify(lead.assignments.slice(1))
      || EJSON.stringify(after.serviceSelections) !== EJSON.stringify(lead.serviceSelections)) throw new Error('Other services changed');
    await appRequire('./src/services/crmCache').invalidateCrmCache();
    console.log(JSON.stringify({ check: 'scoped-po-reset-complete', verified: true, backupSaved: true, remainingPoRows: 0, otherServicesUnchanged: true }));
  } catch (error) {
    console.error(JSON.stringify({ check: 'scoped-po-reset-failed', name: error.name, reason: error.name === 'Error' ? error.message : 'Database operation failed' }));
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    await appRequire('./src/services/redisStore').redisStore.disable();
  }
})();
