const test = require('node:test');
const assert = require('node:assert/strict');

test('20 MICRONS exports both applicant services and their own closure and PO statuses', async () => {
  const { leadServiceExportRecords } = await import('../../frontend/src/utils/leadServiceExport.mjs');
  const lead = {
    leadCode: 'ATPL-LEAD-0391', company: '20 MICRONS LIMITED', closedByText: 'First Service Owner',
    serviceSelections: [
      { assignedServiceId: 'brand', applicantType: 'PIBO', subApplicantType: 'Brand Owner', servicesOffered: 'Annual Return Filling', plantUnit: 'Unit 1' },
      { assignedServiceId: 'importer', applicantType: 'PIBO', subApplicantType: 'Importer', servicesOffered: 'Annual Return Filling', plantUnit: 'Unit 1' }
    ],
    // Deliberately reorder assignments: matching must use service identity.
    assignments: [
      { assignedServiceId: 'importer', poStatus: 'received', poApprovalStatus: 'PENDING', poYearRows: [{ poNumber: 'IMPORT-PO', poAmount: 20000 }] },
      { assignedServiceId: 'brand', closedByText: 'Brand Owner', closedAt: '2026-10-10', poStatus: 'received', poApprovalStatus: 'APPROVED', poYearRows: [{ poNumber: 'BRAND-PO', poAmount: 50000 }] }
    ]
  };
  const rows = leadServiceExportRecords(lead);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => row.subApplicantType), ['Brand Owner', 'Importer']);
  assert(rows.every(row => row.company === '20 MICRONS LIMITED' && row.leadCode === 'ATPL-LEAD-0391'));
  assert.deepEqual(rows.map(row => row.exportLeadClosed), ['Yes', 'No']);
  assert.deepEqual(rows.map(row => row.exportPoReceived), ['Yes', 'Yes']);
  assert.deepEqual(rows.map(row => row.exportPoClosed), ['Yes', 'No']);
  assert.deepEqual(rows.map(row => row.assignments[0].poYearRows[0].poNumber), ['BRAND-PO', 'IMPORT-PO']);
  assert.equal(rows[1].closedByText, '');
});

test('legacy single-service leads export once and retain their saved closure', async () => {
  const { leadServiceExportRecords } = await import('../../frontend/src/utils/leadServiceExport.mjs');
  const [row] = leadServiceExportRecords({ company: 'Legacy', servicesOffered: 'Registration', closedByText: 'Owner', poStatus: 'received', poApprovalStatus: 'APPROVED', poYearRows: [{ poNumber: 'PO-1' }] });
  assert.equal(row.exportLeadClosed, 'Yes');
  assert.equal(row.exportPoReceived, 'Yes');
  assert.equal(row.exportPoClosed, 'Yes');
});

test('provisional closure does not claim PO receipt; permanent confirmation includes original PO', async () => {
  const { leadServiceExportRecords } = await import('../../frontend/src/utils/leadServiceExport.mjs');
  const lead = { serviceSelections: [{ assignedServiceId: 'one', servicesOffered: 'Annual Return Filling' }], assignments: [{ assignedServiceId: 'one', closedByText: 'Owner', poStatus: 'provisional', poApprovalStatus: 'APPROVED' }] };
  let [row] = leadServiceExportRecords(lead);
  assert.equal(row.exportLeadClosed, 'Yes');
  assert.equal(row.exportPoReceived, 'No');
  assert.equal(row.exportPoClosed, 'No');
  lead.assignments[0].permanentClosedAt = '2026-10-10';
  lead.assignments[0].originalPoDetails = { poNumber: 'ORIGINAL-PO', poAmount: 30000 };
  [row] = leadServiceExportRecords(lead);
  assert.equal(row.exportPoReceived, 'Yes');
  assert.equal(row.exportPoClosed, 'Yes');
  assert.equal(row.assignments[0].poYearRows[0].poNumber, 'ORIGINAL-PO');
});

test('a sibling assignment never supplies closure or PO details for an unmatched service', async () => {
  const { leadServiceExportRecords } = await import('../../frontend/src/utils/leadServiceExport.mjs');
  const [row] = leadServiceExportRecords({ serviceSelections: [{ assignedServiceId: 'one' }], assignments: [{ assignedServiceId: 'other', closedByText: 'Owner', poStatus: 'received' }] });
  assert.equal(row.exportLeadClosed, 'No');
  assert.equal(row.exportPoReceived, 'No');
});

test('the directory Excel export writes both services and the three requested status columns', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  const XLSX = require('../../frontend/node_modules/xlsx');
  const { leadServiceExportRecords } = await import('../../frontend/src/utils/leadServiceExport.mjs');
  const page = fs.readFileSync(path.join(__dirname, '../../frontend/src/pages/LeadGeneration.jsx'), 'utf8');
  const start = page.indexOf('  function leadClosureDetails(item = {})');
  const source = page.slice(start, page.indexOf('\n  return (', start));
  let workbook;
  await vm.runInNewContext(`${source}\nexportExcel();`, {
    leadServiceExportRecords,
    onExportAll: async () => [{ company: '20 MICRONS LIMITED', leadCode: 'ATPL-LEAD-0391', serviceSelections: [
      { assignedServiceId: 'brand', applicantType: 'PIBO', subApplicantType: 'Brand Owner', servicesOffered: 'Annual Return Filling', firstAnnualReturnYearApplicable: '2025-26' },
      { assignedServiceId: 'import', applicantType: 'PIBO', subApplicantType: 'Importer', servicesOffered: 'Annual Return Filling', firstAnnualReturnYearApplicable: '2025-26' }
    ] }],
    XLSX: { utils: XLSX.utils, writeFile: value => { workbook = value; } },
    query: '', statusFilter: '', staffFilter: '', metricFilter: '', workspaceTab: 'all', filteredLeads: [], selectedMetric: null, staff: [],
    displayLeadId: row => row.leadCode, inferPiboParent: () => '', resolveLeadStaffName: () => '', resolveLeadAssignedBy: () => ''
  });
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets.Leads);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => row['Sub Applicant Type']), ['Brand Owner', 'Importer']);
  assert(rows.every(row => row['Services Offered'] === 'Annual Return Filling' && row['Financial Year'] === '2025-26'));
  for (const column of ['PO Closed', 'Lead Closed', 'PO Received']) assert(rows.every(row => row[column] === 'No'));
});
