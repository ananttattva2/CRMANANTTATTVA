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
  const lead = await leads.findOne({ leadCode: 'ATPL-LEAD-0141', company: 'ATUL LTD', deletedAt: null });
  if (!lead) throw new Error('Expected active ATUL LTD lead 0141.');
  const approval = await db.collection('pendingapprovals').findOne({ _id: new mongoose.Types.ObjectId('6aca0334be7245d316940539'), type: 'purchase_order', approvalStatus: 'APPROVED', deletedAt: null });
  if (!approval || String(approval.payload?.leadId) !== String(lead._id)) throw new Error('Approved PO lead mismatch.');
  const serviceId = String(approval.payload.assignedServiceId || '');
  const index = lead.assignments.findIndex(row => serviceId && String(row.assignedServiceId) === serviceId);
  if (index < 0 || !lead.assignments[index].closureRequestedBy) throw new Error('Assignment or closure requester missing.');
  const normalize = rows => JSON.stringify((rows || []).map(row => [String(row.poNumber || '').trim(), String(row.poDate || '').trim(), Number(row.poAmount) || 0, String(row.poFileUrl || '').trim()]));
  if (!approval.payload.poYearRows?.length || normalize(lead.assignments[index].poYearRows) !== normalize(approval.payload.poYearRows)) throw new Error('Current PO differs from approved snapshot. No changes made.');
  const oldStatus = lead.assignments[index].poApprovalStatus;
  if (!['PENDING', 'APPROVED'].includes(oldStatus)) throw new Error('Unexpected assignment status.');
  if (!args.includes('--apply')) { console.log(JSON.stringify({ dryRun: true, leadCode: lead.leadCode, assignmentIndex: index, assignmentStatus: oldStatus, approvedSnapshotMatches: true })); return; }
  if (oldStatus !== 'APPROVED') {
    const result = await leads.updateOne({ _id: lead._id, updatedAt: lead.updatedAt, [`assignments.${index}.poApprovalStatus`]: oldStatus }, {
      $set: { [`assignments.${index}.poApprovalStatus`]: 'APPROVED', updatedAt: new Date() }
    });
    if (result.matchedCount !== 1) throw new Error('Lead changed concurrently; retry.');
  }
  const verified = await leads.findOne({ _id: lead._id });
  if (verified.assignments[index].poApprovalStatus !== 'APPROVED') throw new Error('Verification failed.');
  console.log(JSON.stringify({ leadCode: lead.leadCode, company: lead.company, assignmentIndex: index, status: 'APPROVED', managerAssignmentReady: Boolean(verified.assignments[index].closureRequestedBy), verified: true }));
}
run().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
