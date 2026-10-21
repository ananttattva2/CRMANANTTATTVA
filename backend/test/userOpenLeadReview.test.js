const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const load = () => import(pathToFileURL(path.resolve(__dirname, '../../frontend/src/utils/userOpenLeadReview.mjs')));
const lead = (id, extra = {}) => ({ _id: id, createdByName: 'Asha', createdByEmail: 'asha@example.com', createdAt: '2026-10-20T18:45:00Z', company: 'Test Company', communicationMode: 'TeleCalling', communicationModeNote: 'Call next week', ...extra });
test('user summary counts leads once and excludes converted temporary leads', async () => {
  const { leadReviewRows, summarizeReviewRows } = await load();
  const rows = leadReviewRows([lead('one'), lead('one'), lead('two', { communicationMode: 'Referral' })], [lead('temp', { status: 'DRAFT' }), lead('converted', { status: 'CONVERTED' })]);
  const [user] = summarizeReviewRows(rows);
  assert.equal(rows.length, 3); assert.equal(user.open, 2); assert.equal(user.temporary, 1); assert.equal(user.total, 3);
  assert.equal(user.modes.TeleCalling, 1); assert.equal(user.modes.Referral, 1);
  assert.equal(Object.values(user.modes).reduce((a,b) => a+b, 0), user.open);
});
test('legacy imported owners do not collapse into the importing administrator', async () => {
  const { leadReviewRows, summarizeReviewRows } = await load();
  const creator = { _id: 'admin', name: 'Administrator', email: 'admin@example.com' };
  const rows = leadReviewRows([lead('one', { importedCreatedBy: 'Asha', createdBy: creator, createdByEmail: '' }), lead('two', { importedCreatedBy: 'Ravi', createdByName: '', createdBy: creator, createdByEmail: '' })]);
  assert.equal(summarizeReviewRows(rows).length, 2);
});
test('populated and legacy text owners resolve to the same user', async () => {
  const { leadReviewRows, summarizeReviewRows } = await load();
  const rows = leadReviewRows([lead('one'), lead('two', { createdByName: '', createdByEmail: '', importedCreatedBy: 'asha' })], [lead('temp', { createdBy: { _id: 'asha-id', name: 'Asha', email: 'asha@example.com' }, status: 'DRAFT' })]);
  assert.equal(summarizeReviewRows(rows).length, 1);
});
test('filters apply to notes, modes, lead type, owner and India date boundaries', async () => {
  const { leadReviewRows, filterReviewRows } = await load();
  const rows = leadReviewRows([lead('one'), lead('two', { communicationMode: 'Referral', communicationModeNote: '', notes: '' })], [lead('temp', { status: 'DRAFT', followUpRemarks: 'Reminder tomorrow' })]);
  assert.equal(filterReviewRows(rows, { search: 'NEXT WEEK' }).length, 1);
  assert.equal(filterReviewRows(rows, { mode: 'Referral', type: 'lead' }).length, 1);
  assert.equal(filterReviewRows(rows, { type: 'temp', search: 'reminder' }).length, 1);
  assert.equal(filterReviewRows(rows, { note: 'without', type: 'lead' }).length, 1);
  assert.equal(filterReviewRows(rows, { from: '2026-10-21', to: '2026-10-21' }).length, 3);
  assert.equal(filterReviewRows(rows, { to: '2026-10-20' }).length, 0);
  assert.equal(filterReviewRows(rows, { user: 'unknown' }).length, 0);
  assert.equal(filterReviewRows(rows, { days: '7' }, Date.parse('2026-11-21')).length, 0);
});
test('all communication sources including Call have explicit counts and unknown source is retained', async () => {
  const { COMMUNICATION_MODES, leadReviewRows, summarizeReviewRows } = await load();
  const rows = leadReviewRows(COMMUNICATION_MODES.map((mode, index) => lead(String(index), { communicationMode: mode })));
  const [user] = summarizeReviewRows(rows);
  COMMUNICATION_MODES.forEach(mode => assert.equal(user.modes[mode], 1));
  assert.equal(leadReviewRows([lead('unknown', { communicationMode: 'custom source' })])[0].mode, 'Other / Not specified');
});
