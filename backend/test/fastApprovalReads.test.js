const { test } = require('node:test');
const assert = require('node:assert/strict');
const { approvalLeads } = require('../src/services/approvalLeadLookup');
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const matches = (rows, company) => rows.some(row => row.company.toLowerCase() === company.toLowerCase());
function model(batches, calls) { return { find(filter) { calls.push(filter); return { select() { return this; }, populate() { return this; }, maxTimeMS() { return this; }, lean: async () => batches.shift() || [] }; } }; }
test('PO enrichment uses only indexed identities when the stored IDs resolve', async () => {
 const calls = []; const rows = [{ _id: '1', company: 'Company A' }];
 const result = await approvalLeads({ Lead: model([rows], calls), lookup: [{ _id: { $in: ['1'] } }], companies: ['Company A'], projection: 'company', escapeRegex, matches });
 assert.equal(calls.length, 1); assert.equal(JSON.stringify(calls).includes('$regex'), false); assert.deepEqual(result, rows);
});
test('legacy company lookup only scans missing companies and preserves mixed matches', async () => {
 const calls = []; const result = await approvalLeads({ Lead: model([[{ _id: '1', company: 'Found' }], [{ _id: '2', company: 'Legacy' }]], calls), lookup: [{ leadCode: { $in: ['AT-1'] } }], companies: ['Found', 'Legacy'], projection: 'company', escapeRegex, matches });
 assert.equal(calls.length, 2); assert.equal(calls[1].$or.length, 1); assert.equal(calls[1].$or[0].company.$regex, '^Legacy$'); assert.equal(result.length, 2);
});
test('PO-only feed skips service backfill and preserves staff visibility filters', async () => {
 const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
 const source = fs.readFileSync(path.resolve(__dirname, '../src/controllers/leadController.js'), 'utf8');
 const start = source.indexOf('exports.listDuplicateLeadApprovals ='), end = source.indexOf('\nexports.', start + 1);
 const calls = []; const context = { exports: {}, Date, require: name => require(name.replace('../services/', '../src/services/')), userHasAnyRole: () => false, ADMIN_ROLES: ['admin'], Notification: { find() { assert.fail('A PO read must not scan or rewrite service notifications'); } }, Lead: { collection: { collectionName: 'leads' } }, PendingApproval: { collection: { collectionName: 'approvals' }, find(filter) { calls.push(filter); return { select() { return this; }, populate() { return this; }, sort() { return this; }, limit() { return this; }, lean: async () => [] }; } } };
 vm.createContext(context); vm.runInContext(source.slice(start, end), context);
 let response; await context.exports.listDuplicateLeadApprovals({ query: { listOnly: 'true', type: 'purchase_order' }, user: { _id: 'staff-1', email: 'staff@example.com' } }, { json: value => { response = value; } });
 assert.equal(calls.length, 2); for(const filter of calls) { assert.deepEqual(Array.from(filter.type.$in), ['purchase_order']); assert.ok(filter.$or.some(row => row['payload.poSubmittedById'] === 'staff-1')); }
 assert.equal(response.approvals.length, 0);
});

for (const snapshot of [false, true]) test(`PO list preserves Finance remarks and Payment Data (${snapshot ? 'admin snapshot' : 'staff query'})`, async () => {
 const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
 const source = fs.readFileSync(path.resolve(__dirname, '../src/controllers/leadController.js'), 'utf8');
 const start = source.indexOf('exports.listDuplicateLeadApprovals ='), end = source.indexOf('\nexports.', start + 1);
 const review = { stage: 'LEAD_CLOSURE_PENDING', version: 3, frozen: true, financeReferral: { remarks: 'Confirm advance', name: 'Finance' }, leadOwnerRequest: { paymentDate: '2026-12-15', paymentData: 'Legacy payment details' } };
 const leadId = '507f1f77bcf86cd799439011';
 const leadReads = [];
 const leads = [{ _id: leadId, company: 'Example Client', serviceSelections: [
   { assignedServiceId: 'other', servicesOffered: 'Registration' },
   { assignedServiceId: 'requested', servicesOffered: 'Annual Return Filing' }
 ] }];
 const project = selection => {
   const fields = new Set(selection.split(/\s+/));
   return { type: 'purchase_order', approvalStatus: 'PARTIALLY_APPROVED', poReview: Object.fromEntries(Object.entries(review).filter(([key]) => fields.has(`poReview.${key}`))), clientName: 'Example Client', payload: { leadId, assignmentIndex: 0, assignedServiceId: 'requested', service: {}, poYearRows: [{ poNumber: 'PO-1', poAmount: 30000 }] } };
 };
 const context = { exports: {}, Date, console, ADMIN_ROLES: ['admin'], userHasAnyRole: () => snapshot,
   require: name => name === '../services/compactReadSnapshot' ? { compactReadSnapshot: async (Model, options) => [project(options.selection)] } : require(name.replace('../services/', '../src/services/')),
   Notification: { find() { assert.fail('PO feed must not scan notifications'); } }, Lead: { ...model([leads], leadReads), collection: { collectionName: 'leads' } },
   mongoose: { isValidObjectId: value => /^[a-f\d]{24}$/i.test(String(value)) }, escapeRegex,
   Quotation: { find() { assert.fail('A missing service name alone must not require quotations'); } },
   PendingApproval: { db: { readyState: snapshot ? 1 : 0 }, collection: { collectionName: 'approvals' }, populate: async rows => rows,
     find(filter) { let selection; return { select(value) { selection = value; return this; }, populate() { return this; }, sort() { return this; }, limit() { return this; }, lean: async () => filter.approvalStatus.$in.includes('PARTIALLY_APPROVED') ? [project(selection)] : [] }; } }
 };
 vm.runInNewContext(source.slice(start, end), context);
 let response;
 await context.exports.listDuplicateLeadApprovals({ query: { listOnly: 'true', type: 'purchase_order' }, user: { _id: 'staff-1' } }, { json: value => { response = value; }, status() { assert.fail('PO feed failed'); } });
 assert.equal(response.approvals.length, 1);
 assert.equal(leadReads.length, 1);
 assert.equal(response.approvals[0].payload.service.servicesOffered, 'Annual Return Filing');
 assert.equal(response.approvals[0].payload.poYearRows[0].poAmount, 30000);
 assert.equal(response.approvals[0].poReview.financeReferral?.remarks, 'Confirm advance');
 assert.equal(response.approvals[0].poReview.leadOwnerRequest?.paymentDate, '2026-12-15');
 assert.equal(response.approvals[0].poReview.leadOwnerRequest?.paymentData, 'Legacy payment details');
});
