const test = require('node:test');
const assert = require('node:assert/strict');
const { addBusinessDaysInIst, normalizeProvisionalClosure, permanentlyCloseProvisionalAssignments } = require('../src/utils/provisionalClosureDeadline');
const Lead = require('../src/models/Lead');
const LeadActivity = require('../src/models/LeadActivity');
const User = require('../src/models/User');
const mailer = require('../src/utils/mailer');
const sent = [];
const originalSend = mailer.sendMail;
mailer.sendMail = async (...args) => { sent.push(args); };
const { processExpiredProvisionalClosures } = require('../src/services/provisionalLeadClosureWorkflow');
const originalFind = Lead.find, originalActivity = LeadActivity.create, originalUsers = User.find;
test.after(() => { Lead.find = originalFind; LeadActivity.create = originalActivity; User.find = originalUsers; mailer.sendMail = originalSend; });

test('Seven business days excludes weekends and does not count the closure day', () => {
  assert.equal(addBusinessDaysInIst('2026-09-17T11:08:00Z').toISOString(), '2026-09-28T11:08:00.000Z');
  assert.equal(addBusinessDaysInIst('2026-09-18T11:08:00Z').toISOString(), '2026-09-29T11:08:00.000Z');
  assert.equal(addBusinessDaysInIst('2026-09-20T11:08:00Z').toISOString(), '2026-09-29T11:08:00.000Z');
});

test('The business calendar uses IST even when UTC is still the previous date', () => {
  assert.equal(addBusinessDaysInIst('2026-09-17T20:00:00Z').toISOString(), '2026-09-28T20:00:00.000Z');
});

test('New closures use the server clock and ignore client-supplied deadlines', () => {
  const row = normalizeProvisionalClosure({ poStatus: 'provisional', provisionalCloseExpiresAt: '2099-01-01' }, {}, new Date('2026-09-17T11:08:00Z'));
  assert.equal(row.provisionalCloseExpiresAt, '2026-09-28T11:08:00.000Z');
  assert.equal(row.provisionalCloseDeadlineBusinessDays, 7);
});

test('Editing a provisional closure preserves its original seven-day deadline', () => {
  const previous = { poStatus: 'provisional', provisionalCloseExpiresAt: '2026-09-28T11:08:00.000Z', provisionalCloseDeadlineBusinessDays: 7 };
  const row = normalizeProvisionalClosure({ ...previous, provisionalCloseExpiresAt: '2099-01-01' }, previous, new Date('2026-09-24'));
  assert.equal(row.provisionalCloseExpiresAt, previous.provisionalCloseExpiresAt);
});

test('Pending legacy closures get seven business days from their original closure time', () => {
  const previous = { poStatus: 'provisional', provisionalCloseExpiresAt: '2026-09-17T11:18:00.000Z' };
  const row = normalizeProvisionalClosure(previous, previous);
  assert.equal(row.provisionalCloseExpiresAt, '2026-09-28T11:08:00.000Z');
});

test('Original PO confirmation permanently closes only provisional services and removes their reopen deadline', () => {
  const received = { poStatus: 'received', closedBy: 'received-closer' };
  const result = permanentlyCloseProvisionalAssignments([
    { poStatus: 'provisional', closedBy: 'closer', provisionalCloseExpiresAt: '2026-09-28T11:08:00.000Z', provisionalCloseDeadlineBusinessDays: 7 },
    received
  ], { _id: 'user-1', name: 'CRM User' }, [{ assignmentIndex: 0, fy: '2026-27', poNumber: 'PO-100', poDate: '2026-09-21', poAmount: 50000, service: 'Category 1 - EOL', poFileUrl: 'https://example.com/original-po.pdf', poFileName: 'original-po.pdf', poFileType: 'application/pdf', poFileSize: 1234, poPublicId: 'po-1' }], new Date('2026-09-21T08:00:00.000Z'));
  assert.equal(result.changedCount, 1);
  assert.equal(result.assignments[0].poStatus, 'permanently_closed');
  assert.equal(result.assignments[0].originalPoConfirmed, true);
  assert.equal(result.assignments[0].permanentClosedBy, 'user-1');
  assert.equal(result.assignments[0].permanentClosedByText, 'CRM User');
  assert.equal(result.assignments[0].permanentClosedAt, '2026-09-21T08:00:00.000Z');
  assert.equal(result.assignments[0].originalPoFileUrl, 'https://example.com/original-po.pdf');
  assert.equal(result.assignments[0].originalPoFileName, 'original-po.pdf');
  assert.equal(result.assignments[0].originalPoFileType, 'application/pdf');
  assert.equal(result.assignments[0].originalPoFileSize, 1234);
  assert.equal(result.assignments[0].originalPoPublicId, 'po-1');
  assert.equal(result.assignments[0].originalPoDetails.fy, '2026-27');
  assert.equal(result.assignments[0].originalPoDetails.poNumber, 'PO-100');
  assert.equal(result.assignments[0].originalPoDetails.poDate, '2026-09-21');
  assert.equal(result.assignments[0].originalPoDetails.poAmount, 50000);
  assert.equal(result.assignments[0].originalPoDetails.service, 'Category 1 - EOL');
  assert.equal(result.assignments[0].provisionalCloseExpiresAt, '');
  assert.equal(result.assignments[0].provisionalCloseDeadlineBusinessDays, 0);
  assert.equal(result.assignments[1], received);
});

test('The scheduler extends a legacy ten-minute deadline without reopening the service', async () => {
  let saved = 0;
  const lead = { assignments: [{ poStatus: 'provisional', closedBy: 'closer', provisionalCloseExpiresAt: new Date(Date.now() - 60000).toISOString() }], save: async () => { saved += 1; } };
  Lead.find = async () => [lead];
  LeadActivity.create = async () => { throw new Error('A closure still in its seven-day window must not reopen'); };
  const result = await processExpiredProvisionalClosures();
  assert.equal(saved, 1);
  assert.equal(result.reopenedServices, 0);
  assert.equal(lead.assignments[0].closedBy, 'closer');
  assert.equal(lead.assignments[0].provisionalCloseDeadlineBusinessDays, 7);
  assert.ok(new Date(lead.assignments[0].provisionalCloseExpiresAt) > new Date());
});

test('Only expired provisional services freeze; ownership, received POs and other services remain intact', async () => {
  sent.length = 0;
  const now = Date.now();
  const received = { poStatus: 'received', closedBy: 'received-closer', provisionalCloseExpiresAt: new Date(now - 60000).toISOString() };
  const future = { poStatus: 'provisional', closedBy: 'future-closer', provisionalCloseDeadlineBusinessDays: 7, provisionalCloseExpiresAt: new Date(now + 86400000).toISOString() };
  const permanent = { poStatus: 'permanently_closed', closedBy: 'permanent-closer', provisionalCloseExpiresAt: '' };
  const lead = { _id: 'test-lead', company: 'Sample', assignments: [
    { poStatus: 'provisional', closedBy: 'expired-closer', closedByEmail: 'closer@example.com', provisionalCloseDeadlineBusinessDays: 7, provisionalCloseExpiresAt: new Date(now - 60000).toISOString() }, received, future, permanent
  ], save: async () => {} };
  Lead.find = async () => [lead];
  LeadActivity.create = async () => {};
  User.find = () => ({ select: () => ({ lean: async () => [] }) });
  const result = await processExpiredProvisionalClosures();
  assert.equal(result.frozenServices, 1);
  assert.equal(result.reopenedServices, 0);
  assert.equal(lead.assignments[0].closedBy, 'expired-closer');
  assert.ok(lead.assignments[0].poDeadlineFrozenAt);
  assert.equal(lead.assignments[1], received);
  assert.equal(lead.assignments[2].closedBy, future.closedBy);
  assert.equal(lead.assignments[3], permanent);
  assert.equal(sent.length, 1);
  assert.match(sent[0][2], /7-business-day deadline/);
});
