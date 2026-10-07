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

test('annual eligibility follows assigned services offered and applicant labels resolve the assigned service', async () => {
  const { applicationRecord, applicantCategory } = await import('../../frontend/src/utils/applicationPortfolio.mjs');
  const row = client('a', 'sonal', '', 'Approved');
  row.assignedServiceId = 'importer';
  row.selectedLead.serviceSelections = [{ assignedServiceId: 'producer', subApplicantType: 'Producer' }, { assignedServiceId: 'importer', subApplicantType: 'Importer', firstAnnualReturnYearApplicable: '2025-26', servicesOffered: 'Annual Return Filling' }];
  assert.equal(applicationRecord(row).category, 'Importer');
  assert.equal(applicationRecord(row).annual, true);
  assert.equal(applicantCategory('Importer of Raw Material'), 'Importer of Raw Material');
  assert.equal(applicantCategory('Producer (Small & Micro)'), 'Producer (Small & Micro)');
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
  assert.deepEqual(STATUS_COLUMNS.slice(3).map(column => column[1]), ['Approved', 'Applied', 'Under Review', 'Not Started', 'Rejected']);
});

test('company approval requires all assigned service statuses approved; missing status remains visible in details', async () => {
  const { buildApplicationPortfolio } = await import('../../frontend/src/utils/applicationPortfolio.mjs');
  const [group] = buildApplicationPortfolio([client('a', 'sonal', 'Importer', 'Approved'), client('b', 'sonal', 'Producer', '')], users);
  assert.equal(group.companyRecords[0].bucket, 'notStarted');
  assert.equal(group.companyRecords[0].services[1].cpcb, 'Not recorded');
  assert.equal(group.companyRecords[0].live, true);
});


test('PIBo headers match the seven requested categories and SIMP producer variants merge', async () => {
  const { PIBO_CATEGORIES, applicantCategory, buildApplicationPortfolio } = await import('../../frontend/src/utils/applicationPortfolio.mjs');
  assert.deepEqual(PIBO_CATEGORIES, ['Producer', 'Brand Owner', 'PWP', 'Importer', 'Producer (Small & Micro)', 'Importer of Raw Material', 'Recycler']);
  assert.equal(applicantCategory('SIMP Producer Small-Micro'), 'Producer (Small & Micro)');
  assert.equal(applicantCategory('SIMP Producer (Small & Micro)'), 'Producer (Small & Micro)');
  assert.equal(applicantCategory('SIMP Importer of Raw Material'), 'Importer of Raw Material');
  const [group] = buildApplicationPortfolio([client('a', 'sonal', 'SIMP Producer Small-Micro'), client('b', 'sonal', 'Producer (Small & Micro)')], users);
  assert.equal(group.records.length, 1);
});


test('annual applicability excludes registration despite a saved annual year and accepts Filing/Filling arrays', async () => {
  const { applicationRecord } = await import('../../frontend/src/utils/applicationPortfolio.mjs');
  const row = client('a', 'sonal', 'Producer', 'Approved');
  row.data.basic.firstAnnualReturnYear = '2025-26';
  row.data.basic.servicesOffered = 'New Registration';
  assert.equal(applicationRecord(row).annual, false);
  row.data.basic.servicesOffered = ['Consulting', 'Annual Return Filing'];
  assert.equal(applicationRecord(row).annual, true);
  row.assignedServiceId = 'registration';
  row.selectedLead.serviceSelections = [{ assignedServiceId: 'annual', servicesOffered: 'Annual Return Filling' }, { assignedServiceId: 'registration', servicesOffered: 'New Registration' }];
  assert.equal(applicationRecord(row).annual, false);
});


test('same-company lead IDs and identical-category service records survive popup grouping and lead-ID search', async () => {
  const { buildApplicationPortfolio, matchesPortfolioSearch } = await import('../../frontend/src/utils/applicationPortfolio.mjs');
  const a = client('a', 'sonal', 'Recycler', 'Approved');
  const b = client('b', 'sonal', 'Recycler', 'Approved');
  a.selectedLead.company = 'RG INDUSTRIAL CORPORATION'; a.selectedLead.leadCode = 'ATPL-LEAD-0013';
  b.selectedLead.company = 'R.G. INDUSTRIAL CORPORATION'; b.selectedLead.leadCode = 'ATPL-LEAD-0412';
  const [group] = buildApplicationPortfolio([a, b], users);
  assert.equal(group.companyRecords.length, 1);
  assert.equal(group.companyRecords[0].services.length, 2);
  assert.equal(group.records[0].services.length, 2);
  assert.match(group.companyRecords[0].code, /0013/);
  assert.match(group.companyRecords[0].code, /0412/);
  assert.equal(matchesPortfolioSearch(group.companyRecords[0], 'ATPL-LEAD-0013'), true);
  assert.equal(matchesPortfolioSearch(group.records[0], 'ATPL-LEAD-0412'), true);
  const typo = { name: 'RG INDUSTRIAL CORPRATION' };
  assert.equal(matchesPortfolioSearch(typo, 'R.G. INDUSTRIAL CORPORATION'), true);
});


test('Annual Return and Annual Filing/Filling aliases appear in the same applicability popup', async () => {
  const { isAnnualReturnService, buildApplicationPortfolio } = await import('../../frontend/src/utils/applicationPortfolio.mjs');
  for (const label of ['Annual Return', 'Annual Return Filing', 'Annual Return Filling', 'Annual Filing', 'Annual Filling', 'ANNUAL-FILLING']) assert.equal(isAnnualReturnService(label), true, label);
  assert.equal(isAnnualReturnService('New Registration'), false);
  assert.equal(isAnnualReturnService(['Consulting', 'Annual Filling']), true);
  const a = client('a', 'sonal', 'Recycler'); a.selectedLead.company = 'RG INDUSTRIAL CORPRATION'; a.selectedLead.leadCode = 'ATPL-LEAD-0013'; a.data.basic.servicesOffered = 'Annual Filling';
  const b = client('b', 'sonal', 'Producer'); b.selectedLead.company = 'R.G. INDUSTRIAL CORPORATION'; b.selectedLead.leadCode = 'ATPL-LEAD-0412'; b.data.basic.servicesOffered = 'Annual Filing';
  const [group] = buildApplicationPortfolio([a, b], users);
  assert.deepEqual(group.companyRecords.filter(row => row.annual).map(row => row.leadCode), ['ATPL-LEAD-0013', 'ATPL-LEAD-0412']);
});


test('service summary headers come only from closed assigned services and annual aliases merge', async () => {
  const { buildApplicationPortfolio, offeredServiceColumns } = await import('../../frontend/src/utils/applicationPortfolio.mjs');
  const a = client('a', 'sonal', 'Producer'); a.assignedServiceId = 'a'; a.selectedLead.assignments = [{ assignedStaff: 'sonal', assignedServiceId: 'a', closedAt: '2026-10-01' }]; a.data.basic.servicesOffered = 'Annual Filling';
  const b = client('b', 'sonal', 'Importer'); b.assignedServiceId = 'b'; b.selectedLead.assignments = [{ assignedStaff: 'sonal', assignedServiceId: 'b', closedAt: '2026-10-01' }]; b.data.basic.servicesOffered = 'Annual Return Filling';
  const c = client('c', 'sonal', 'Producer'); c.selectedLead.company = 'Other Ltd'; c.data.basic.servicesOffered = 'Consulting';
  const d = client('d', 'krishna', 'Importer'); d.assignedServiceId = 'd'; d.selectedLead.assignments = [{ assignedStaff: 'krishna', assignedServiceId: 'd', closedAt: '2026-10-01' }]; d.data.basic.servicesOffered = 'New Registration';
  const groups = buildApplicationPortfolio([a, b, c, d], users);
  assert.deepEqual(offeredServiceColumns(groups), ['Annual Return Filling', 'New Registration']);
  const sonal = groups.find(group => group.id === 'sonal');
  assert.equal(sonal.closedCompanies.length, 1);
  assert.equal(sonal.closedCompanies[0].services.length, 2);
  assert.equal(sonal.closedCompanies[0].services.filter(service => service.offeredServices.includes('Annual Return Filling')).length, 2);
});

test('service summary ignores an open assigned service even when a sibling service is closed', async () => {
  const { applicationRecord } = await import('../../frontend/src/utils/applicationPortfolio.mjs');
  const row = client('a', 'sonal', 'Importer'); row.assignedServiceId = 'open';
  row.selectedLead.assignments = [{ assignedServiceId: 'closed', closedAt: '2026-10-01' }, { assignedServiceId: 'open', assignedStaff: 'sonal' }];
  assert.equal(applicationRecord(row).closed, false);
});


test('legacy closed-by records qualify as closed without fabricating a close timestamp', async () => {
  const { applicationRecord } = await import('../../frontend/src/utils/applicationPortfolio.mjs');
  const row = client('a', 'sonal', 'Producer'); row.assignedServiceId = 'a';
  row.selectedLead.assignments = [{ assignedServiceId: 'a', closedByText: 'Sonal' }];
  assert.equal(applicationRecord(row).closed, true);
});


test('application summaries use category totals and split every application into exactly one status', async () => {
  const { buildApplicationPortfolio, applicationSummaryRecords, matchesApplicationService } = await import('../../frontend/src/utils/applicationPortfolio.mjs');
  const a = client('a', 'sonal', 'Importer', 'Approved');
  const b = client('b', 'sonal', 'Importer', 'Applied');
  const c = client('c', 'sonal', 'Producer', 'Approved');
  const d = client('d', 'sonal', 'Brand Owner', '');
  for (const row of [a, b, c]) { row.selectedLead.status = 'Closed'; row.data.basic.servicesOffered = 'Annual Filling'; }
  const [group] = buildApplicationPortfolio([a,b,c,d], users);
  const records = applicationSummaryRecords(group);
  assert.equal(records.length, group.records.length);
  assert.equal(records.length, 3);
  assert.deepEqual(records.map(row => row.bucket), ['applied', 'approved', 'notStarted']);
  assert.equal(records.filter(row => matchesApplicationService(row, 'Annual Return Filling')).length, 2);
  assert.equal(records.filter(row => matchesApplicationService(row, 'unclassified')).length, 1);
  assert.equal(records.filter(row => matchesApplicationService(row, 'total')).length, 3);
  assert.equal(records[0].services.length, 2);
});


test('service breakdown counts each application once and agrees with the Clients Excel sheet', async () => {
  const { buildApplicationPortfolio, applicationSummaryRecords, matchesApplicationService } = await import('../../frontend/src/utils/applicationPortfolio.mjs');
  const { createApplicationPortfolioWorkbook } = await import('../../frontend/src/utils/applicationPortfolioExport.mjs');
  const registration = client('registration', 'sonal', 'Importer of Raw Material', 'Approved');
  const annual = client('annual', 'sonal', 'Importer of Raw Material', 'Approved');
  registration.selectedLead.status = annual.selectedLead.status = 'Closed';
  registration.data.basic.servicesOffered = 'New Registration';
  annual.data.basic.servicesOffered = 'Annual Filling';
  const other = client('other', 'sonal', 'Producer');
  other.selectedLead.status = 'Closed'; other.data.basic.servicesOffered = 'Annual Return';
  const [group] = buildApplicationPortfolio([registration,annual,other], users);
  const rows = applicationSummaryRecords(group);
  assert.equal(rows.length, 2);
  assert.equal(rows.filter(row => matchesApplicationService(row, 'New Registration')).length, 1);
  assert.equal(rows.filter(row => matchesApplicationService(row, 'Annual Return Filling')).length, 1);
  for (const row of rows) assert.equal(['New Registration', 'Annual Return Filling', 'unclassified'].filter(key => matchesApplicationService(row, key)).length, 1);
  const workbook = await createApplicationPortfolioWorkbook(rows, 'Sonal', 'Total');
  const buffer = await workbook.xlsx.writeBuffer();
  const ExcelJS = require('../../frontend/node_modules/exceljs');
  const loaded = new ExcelJS.Workbook(); await loaded.xlsx.load(buffer);
  assert.equal(loaded.getWorksheet('Clients').getCell('L4').value, 'New Registration');
  assert.equal(loaded.getWorksheet('Clients').getCell('L5').value, 'Annual Return Filling');
  assert.equal(loaded.getWorksheet('Service Statuses').rowCount, 6);
  assert.equal(rows[0].services.length, 2);
});
