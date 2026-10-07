const test = require('node:test');
const assert = require('node:assert/strict');
const users = [{ _id: 'sonal', name: 'Sonal', role: 'operation' }, { _id: 'krishna', name: 'Krishna', role: 'operation' }];
const client = (id, owner, category, status = '') => ({ _id: id, selectedLead: { company: '20 MICRONS LIMITED', assignedStaff: owner }, data: { basic: { piboCategory: category }, cpcb: { status }, importMeta: { visibilityStatus: 'LIVE' } } });

test('SPOC distribution deduplicates a company category, retains distinct categories and never merges staff', async () => {
  const { buildApplicationPortfolio } = await import('../../frontend/src/utils/applicationPortfolio.mjs');
  const groups = buildApplicationPortfolio([client('a', 'sonal', 'Importer'), client('b', 'sonal', 'Importer'), client('c', 'sonal', 'Producer'), client('d', 'krishna', 'Importer')], users);
  assert.equal(groups.find(group => group.id === 'sonal').records.length, 2);
  assert.equal(groups.find(group => group.id === 'krishna').records.length, 1);
  assert.deepEqual(groups.find(group => group.id === 'sonal').records[0].sourceIds, ['a', 'b']);
});

test('saved CPCB statuses distinguish approved, applied, under review, pending, rejected and missing records', async () => {
  const { applicationRecord } = await import('../../frontend/src/utils/applicationPortfolio.mjs');
  for (const [status, bucket] of [['Approved', 'approved'], ['Applied', 'applied'], ['Under Review', 'underReview'], ['ATPL-PENDING', 'notStarted'], ['PORTAL-REJECTED', 'rejected'], ['', 'notStarted']]) {
    const row = applicationRecord(client('a', 'sonal', 'Importer', status));
    assert.equal(row.bucket, bucket);
    assert.equal(row.cpcb, status || 'Not recorded');
    assert.equal(row.annual, false);
  }
  const discontinued = client('a', 'sonal', 'Importer', 'Approved');
  discontinued.data.importMeta.visibilityStatus = 'DISCONTINUED';
  assert.equal(applicationRecord(discontinued).bucket, 'approved');
  assert.equal(applicationRecord(discontinued).live, false);
});

test('annual eligibility follows saved year and applicant labels resolve the assigned service', async () => {
  const { applicationRecord, applicantCategory } = await import('../../frontend/src/utils/applicationPortfolio.mjs');
  const row = client('a', 'sonal', '', 'Approved');
  row.assignedServiceId = 'importer';
  row.selectedLead.serviceSelections = [{ assignedServiceId: 'producer', subApplicantType: 'Producer' }, { assignedServiceId: 'importer', subApplicantType: 'Importer', firstAnnualReturnYearApplicable: '2025-26' }];
  assert.equal(applicationRecord(row).category, 'Importer');
  assert.equal(applicationRecord(row).annual, true);
  assert.equal(applicantCategory('Importer of Raw Material'), 'SIMP Importer of Raw Material');
  assert.equal(applicantCategory('Producer (Small & Micro)'), 'SIMP Producer (Small & Micro)');
  assert.equal(applicantCategory('Recycler'), 'Recycler');
});

test('conflicting saved service statuses remain mixed rather than choosing an approval', async () => {
  const { buildApplicationPortfolio } = await import('../../frontend/src/utils/applicationPortfolio.mjs');
  const [group] = buildApplicationPortfolio([client('a', 'sonal', 'Importer', 'Approved'), client('b', 'sonal', 'Importer', 'Applied')], users);
  assert.equal(group.records.length, 1);
  assert.equal(group.records[0].bucket, 'mixed');
  assert.equal(group.records[0].services.length, 2);
});


test('application summary counts one company per user across applicant categories, matching allocation groups', async () => {
  const { buildApplicationPortfolio, STATUS_COLUMNS } = await import('../../frontend/src/utils/applicationPortfolio.mjs');
  const groups = buildApplicationPortfolio([client('a', 'sonal', 'Importer', 'Approved'), client('b', 'sonal', 'Producer', 'Applied'), client('c', 'krishna', 'Importer', 'Approved')], users);
  const sonal = groups.find(group => group.id === 'sonal');
  assert.equal(sonal.records.length, 2);
  assert.equal(sonal.companyRecords.length, sonal.total);
  assert.equal(sonal.companyRecords.length, 1);
  assert.equal(sonal.companyRecords[0].bucket, 'applied');
  assert.equal(sonal.companyRecords[0].services.length, 2);
  assert.equal(groups.find(group => group.id === 'krishna').companyRecords[0].bucket, 'approved');
  assert.deepEqual(STATUS_COLUMNS.slice(2).map(column => column[1]), ['Not Started', 'Applied', 'Under Review', 'Approved', 'Rejected']);
});

test('company approval requires all assigned service statuses approved; missing status remains visible in details', async () => {
  const { buildApplicationPortfolio } = await import('../../frontend/src/utils/applicationPortfolio.mjs');
  const [group] = buildApplicationPortfolio([client('a', 'sonal', 'Importer', 'Approved'), client('b', 'sonal', 'Producer', '')], users);
  assert.equal(group.companyRecords[0].bucket, 'notStarted');
  assert.equal(group.companyRecords[0].services[1].cpcb, 'Not recorded');
  assert.equal(group.companyRecords[0].live, true);
});
