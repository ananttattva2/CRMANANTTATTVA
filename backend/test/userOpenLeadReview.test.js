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
test('generated Lead Owner stays separate from creator and shared stale import identities', async () => {
  const { leadReviewRows, summarizeReviewRows } = await load();
  const gaurav = { _id: 'gaurav', name: 'GAURAV CHANDRA', email: 'gaurav@example.com', crmUserId: 'CRM-G' };
  const mihir = { _id: 'mihir', name: 'MIHIRDEVSINH ZALA', email: 'mihir@example.com', crmUserId: 'CRM-M' };
  const open = Array.from({ length: 121 }, (_, i) => lead(`g-${i}`, { createdBy: mihir, createdByCrmUserId: 'CRM-M', createdByEmail: mihir.email, importedCreatedBy: mihir.name, generatedForUser: gaurav, generatedForName: gaurav.name, generatedForEmail: gaurav.email }));
  open.push(...Array.from({ length: 118 }, (_, i) => lead(`m-${i}`, { createdBy: mihir, createdByName: mihir.name, createdByEmail: mihir.email, generatedForUser: mihir })));
  const temps = Array.from({ length: 20 }, (_, i) => lead(`t-${i}`, { createdBy: gaurav, createdByName: gaurav.name, createdByEmail: gaurav.email, status: 'DRAFT' }));
  const rows = leadReviewRows(open, temps);
  const summary = summarizeReviewRows(rows);
  assert.equal(summary.length, 2);
  const actual = summary.find(user => user.name === gaurav.name);
  assert.equal(actual.open, 121); assert.equal(actual.temporary, 20); assert.equal(actual.total, 141);
  const detail = rows.filter(row => row.ownerKey === actual.key);
  assert.equal(detail.length, actual.total);
  assert.equal(detail.filter(row => row.temporary).length, actual.temporary);
  assert.equal(summary.find(user => user.name === mihir.name).open, 118);
  assert.equal(summary.reduce((sum, user) => sum + user.total, 0), open.length + temps.length);
});
test('unknown generated owner never falls back to the editor account', async () => {
  const { leadReviewRows, summarizeReviewRows } = await load();
  const rows = leadReviewRows([lead('other', { createdBy: { _id: 'editor', name: 'Editor' }, generatedForName: 'GAURAV CHANDRA' }), lead('self', { createdBy: { _id: 'editor', name: 'Editor' }, createdByName: 'Editor', createdByEmail: '' })]);
  assert.equal(summarizeReviewRows(rows).length, 2);
  assert.equal(rows.find(row => row.lead._id === 'other').ownerName, 'GAURAV CHANDRA');
});
test('two accounts sharing a display name keep distinct IDs and totals', async () => {
  const { leadReviewRows, summarizeReviewRows } = await load();
  const rows = leadReviewRows([lead('one', { generatedForUser: { _id: 'one', name: 'Shared name' } }), lead('two', { generatedForUser: { _id: 'two', name: 'Shared name' } })]);
  assert.equal(summarizeReviewRows(rows).length, 2);
  assert.notEqual(rows[0].ownerKey, rows[1].ownerKey);
});
test('note search handles pasted whitespace, punctuation and words across full notes', async () => {
  const { leadReviewRows, filterReviewRows } = await load();
  const rows = leadReviewRows([
    lead('one', { communicationModeNote: 'Looking for CTE/CTO: EPR registered\nRequested\u00a0for quote', notes: 'Importer + Seller Reg' }),
    lead('two', { communicationModeNote: 'Need to have detailed information for applicability from concern person' })
  ]);
  assert.deepEqual(filterReviewRows(rows, { search: '  CTE CTO EPR  ' }).map(row => row.lead._id), ['one']);
  assert.deepEqual(filterReviewRows(rows, { search: 'Requested for quote' }).map(row => row.lead._id), ['one']);
  assert.deepEqual(filterReviewRows(rows, { search: 'importer seller reg' }).map(row => row.lead._id), ['one']);
  assert.deepEqual(filterReviewRows(rows, { search: 'concern applicability' }).map(row => row.lead._id), ['two']);
  assert.deepEqual(filterReviewRows(rows, { search: 'missing note text' }), []);
});
test('overall temporary rows include current drafts once, with readable owner and note', async () => {
  const { temporaryReviewRecords } = await load();
  const rows = temporaryReviewRecords([
    { _id: 'draft', tempLeadCode: 'ATPL-TEMP-0199', clientName: 'Current draft', status: 'DRAFT', createdAt: '2026-10-21', createdBy: { _id: 'user', name: 'Gaurav' }, followUpRemarks: 'Follow up tomorrow' },
    { _id: 'converted', status: 'CONVERTED' }
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].__temporary, true);
  assert.equal(rows[0].company, 'Current draft');
  assert.equal(rows[0].leadCode, 'ATPL-TEMP-0199');
  assert.equal(rows[0].importedCreatedBy, 'Gaurav');
  assert.equal(rows[0].notes, 'Follow up tomorrow');
});
test('closed review counts each lead once, uses closure dates and excludes temporary drafts', async () => {
  const { leadReviewRows, summarizeReviewRows, filterReviewRows } = await load();
  const owner = { _id: 'gaurav', name: 'GAURAV CHANDRA', email: 'gaurav@example.com' };
  const rows = leadReviewRows([
    lead('closed', { createdAt: '2025-01-01', generatedForUser: owner, closedAt: '2026-10-18T00:00:00Z', serviceSelections: [{ closedAt: '2026-10-19T20:00:00Z' }, { closedAt: '2026-10-21T04:00:00Z' }] }),
    lead('closed', { generatedForUser: owner }),
    lead('undated', { generatedForUser: owner, closedByText: 'Manager' })
  ], [lead('temp', { status: 'DRAFT' })], { mode: 'closed' });
  assert.equal(rows.length, 2);
  const [summary] = summarizeReviewRows(rows);
  assert.equal(summary.closed, 2); assert.equal(summary.open, 0); assert.equal(summary.temporary, 0); assert.equal(summary.total, 2);
  assert.equal(summary.modes.TeleCalling, 2);
  assert.equal(rows[0].date, '2026-10-21T04:00:00Z');
  assert.equal(rows[1].date, '');
  assert.equal(filterReviewRows(rows, { from: '2026-10-21', to: '2026-10-21' }).length, 1);
  assert.equal(filterReviewRows(rows, { days: '7' }, Date.parse('2026-10-22T00:00:00Z')).length, 1);
});
const fixedNow = Date.parse('2026-10-21T10:00:00+05:30');
test('open ageing buckets use India calendar days at exact 30/60/90 boundaries', async () => {
  const { pendingDays, openAgeBucket, summarizeReviewRows, filterReviewRows } = await load();
  const rows = [0, 29, 30, 59, 60, 89, 90, 120].map((days, index) => ({ id: String(index), ownerKey: 'user', ownerName: 'Gaurav', mode: 'TeleCalling', date: new Date(fixedNow - days * 86400000).toISOString(), note: '', lead: {} }));
  assert.deepEqual(rows.map(row => pendingDays(row, fixedNow)), [0, 29, 30, 59, 60, 89, 90, 120]);
  assert.deepEqual(rows.map(row => openAgeBucket(row, fixedNow)), ['0-29', '0-29', '30-59', '30-59', '60-89', '60-89', '90+', '90+']);
  const [summary] = summarizeReviewRows(rows, fixedNow);
  assert.deepEqual(summary.ages, { '0-29': 2, '30-59': 2, '60-89': 2, '90+': 2, unknown: 0 });
  for (const age of ['0-29', '30-59', '60-89', '90+']) assert.equal(filterReviewRows(rows, { age }, fixedNow).length, 2);
  assert.equal(pendingDays({ date: '2026-10-20T18:29:59Z' }, fixedNow), 1);
  assert.equal(pendingDays({ date: '2026-10-20T18:30:00Z' }, fixedNow), 0);
});
test('ageing excludes temporary/closed leads and keeps unknown dates out of 90+ counts', async () => {
  const { openAgeBucket, summarizeReviewRows, filterReviewRows } = await load();
  const base = { ownerKey: 'user', ownerName: 'Gaurav', mode: 'TeleCalling', note: '', lead: {}, date: '2026-01-01' };
  const rows = [{ ...base, temporary: true }, { ...base, closed: true }, { ...base, date: '' }, { ...base, date: 'invalid' }, { ...base, date: '2027-01-01' }];
  assert.deepEqual(rows.map(row => openAgeBucket(row, fixedNow)), [null, null, 'unknown', 'unknown', 'unknown']);
  const [summary] = summarizeReviewRows(rows, fixedNow);
  assert.equal(summary.ages['90+'], 0);
  assert.equal(summary.ages.unknown, 3);
  assert.equal(filterReviewRows(rows, { age: '90+' }, fixedNow).length, 0);
  assert.equal(filterReviewRows(rows, { age: 'unknown' }, fixedNow).length, 3);
});
