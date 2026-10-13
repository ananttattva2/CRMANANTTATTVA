const path = require('node:path');
const args = process.argv.slice(2);
const envIndex = args.indexOf('--env');
require('dotenv').config({ path: envIndex >= 0 ? args[envIndex + 1] : path.resolve(__dirname, '../../.env'), quiet: true });
const mongoose = require('mongoose');
const { __test: dbTest } = require('../config/db');

async function run() {
  await mongoose.connect(dbTest.buildMongoUri(), { dbName: process.env.DB_NAME || 'registerd_types', serverSelectionTimeoutMS: 10000, autoIndex: false, autoCreate: false });
  const db = mongoose.connection.db;
  const leads = db.collection('leads');
  const approvals = db.collection('pendingapprovals');
  const matches = await leads.find({ leadCode: 'ATPL-LEAD-0432', deletedAt: null }).toArray();
  if (matches.length !== 1) throw new Error('Expected exactly one active lead 0432.');
  const lead = matches[0];
  if (String(lead.company).trim().toUpperCase() !== 'RUDOLF ATUL CHEMICALS LIMITED') throw new Error('Company mismatch.');
  const rows = await approvals.find({ type: 'purchase_order', deletedAt: null, $or: [{ 'payload.leadId': String(lead._id) }, { 'payload.leadId': lead._id }] }).toArray();
  const summary = rows.map(row => ({ id: String(row._id), status: row.approvalStatus, assignmentIndex: row.payload?.assignmentIndex, amount: (row.payload?.poYearRows || []).reduce((sum, po) => sum + (Number(po.poAmount) || 0), 0) }));
  if (!args.includes('--apply')) { console.log(JSON.stringify({ dryRun: true, company: lead.company, leadCode: lead.leadCode, approvals: summary }, null, 2)); return; }
  const candidates = summary.filter(row => row.status === 'REJECTED' && row.amount === 85000);
  if (candidates.length !== 1) throw new Error('Expected exactly one rejected INR 85000 PO. No changes made.');
  const approval = rows.find(row => String(row._id) === candidates[0].id);
  const index = Number(approval.payload.assignmentIndex);
  const assignment = lead.assignments?.[index];
  const service = lead.serviceSelections?.[index];
  if (!assignment || !/annual.*(?:return|fil)/i.test(service?.servicesOffered || service?.applicableService || '')) throw new Error('Annual Return assignment mismatch.');
  if (approval.payload.assignedServiceId && String(approval.payload.assignedServiceId) !== String(assignment.assignedServiceId)) throw new Error('Service identity mismatch.');
  const now = new Date();
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const set = { [`assignments.${index}.poApprovalStatus`]: 'APPROVED', updatedAt: now };
      const requester = assignment.closureRequestedBy || approval.payload.closureRequestedBy;
      if (requester) {
        set[`assignments.${index}.closureRequestedBy`] = requester;
        set[`assignments.${index}.closureRequestedByText`] = assignment.closureRequestedByText || approval.payload.closureRequestedByText || '';
        if (assignment.assignedTo) {
          set[`assignments.${index}.closedBy`] = requester;
          set[`assignments.${index}.closedByText`] = set[`assignments.${index}.closureRequestedByText`];
          set[`assignments.${index}.closedAt`] = assignment.closedAt || now;
          set[`assignments.${index}.closureFinalizedByManager`] = true;
        }
      }
      const updatedLead = await leads.updateOne({ _id: lead._id, updatedAt: lead.updatedAt, deletedAt: null }, { $set: set }, { session });
      if (updatedLead.matchedCount !== 1) throw new Error('Lead changed during correction; retry.');
      const corrected = await approvals.updateOne({ _id: approval._id, approvalStatus: 'REJECTED', deletedAt: null }, {
        $set: { approvalStatus: 'APPROVED', remarks: 'Accidental rejection corrected to approval at user request.', actionAt: now, updatedAt: now },
        $push: { 'payload.decisionCorrections': { previousStatus: approval.approvalStatus, previousRemarks: approval.remarks || '', previousActionAt: approval.actionAt, previousActionBy: approval.actionBy, status: 'APPROVED', correctedAt: now, reason: 'User explicitly requested correction of accidental rejection.' } }
      }, { session });
      if (corrected.matchedCount !== 1) throw new Error('Approval changed during correction; retry.');
    });
  } finally { await session.endSession(); }
  const verifiedApproval = await approvals.findOne({ _id: approval._id });
  const verifiedLead = await leads.findOne({ _id: lead._id });
  if (verifiedApproval.approvalStatus !== 'APPROVED' || verifiedLead.assignments[index].poApprovalStatus !== 'APPROVED') throw new Error('Correction verification failed.');
  console.log(JSON.stringify({ leadCode: lead.leadCode, company: lead.company, approvalId: String(approval._id), amount: 85000, approvalStatus: 'APPROVED', assignmentStatus: 'APPROVED', verified: true }, null, 2));
}
run().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
