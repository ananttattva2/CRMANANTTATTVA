const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = () => ({
  _id: 'client-1', assignedServiceId: 's1', data: { basic: { clientLegalName: 'CCL' } },
  selectedLead: { _id: 'lead-1', serviceSelections: [
    { assignedServiceId: 's1', subApplicantType: 'Brand Owner' },
    { assignedServiceId: 's2', subApplicantType: 'Importer' },
    { assignedServiceId: 's3', subApplicantType: 'Producer' }
  ], assignments: [
    { assignedServiceId: 's1', closedAt: '2026-10-09', poYearRows: [{ poNumber: 'PO-1' }] },
    { assignedServiceId: 's2' }, { assignedServiceId: 's3' }
  ] }
});

test('client exports count each PO by its current approval and do not double-count duplicate client masters', async () => {
  const { clientPoCounts, clientPoExportEntries, sumClientPoCounts } = await import('../../frontend/src/features/clientMaster/clientPoStatus.mjs');
  const client = fixture();
  client.selectedLead.assignments[0].poApprovalStatus = 'PENDING'; // stale assignment
  client.poApprovals = [
    { approvalStatus: 'APPROVED', payload: { assignedServiceId: 's1', poYearRows: [{ poNumber: 'PO-1' }, { poNumber: 'PO-2' }] } },
    { approvalStatus: 'PENDING', payload: { assignedServiceId: 's2', poYearRows: [{ poNumber: 'PO-3' }] } },
    { approvalStatus: 'REJECTED', payload: { assignedServiceId: 's3', poYearRows: [{ poNumber: 'PO-4' }] } }
  ];
  assert.deepEqual(clientPoCounts(client), { approved: 2, pending: 1, rejected: 1, revision: 0, unrecorded: 0, total: 4 });
  const entries = clientPoExportEntries([client, { ...client, _id: 'client-2', assignedServiceId: 's2' }]);
  assert.equal(entries.length, 3);
  assert.deepEqual(sumClientPoCounts(entries.map(({ service }) => service.poCounts)), clientPoCounts(client));
});

test('legacy assignment decisions count PO rows and missing PO records do not become pending', async () => {
  const { clientPoCounts } = await import('../../frontend/src/features/clientMaster/clientPoStatus.mjs');
  const client = fixture();
  client.selectedLead.assignments[0].poApprovalStatus = 'APPROVED';
  client.selectedLead.assignments[1].poApprovalStatus = 'REJECTED';
  client.selectedLead.assignments[1].poYearRows = [{ poNumber: 'REJECTED-PO' }];
  assert.equal(clientPoCounts(client).approved, 1);
  assert.equal(clientPoCounts(client).pending, 0);
  assert.equal(clientPoCounts(client).rejected, 1);
  assert.equal(clientPoCounts(client).total, 2);
  client.poApprovals = [{ approvalStatus: 'REVISION_REQUIRED', payload: { assignmentIndex: 2, poYearRows: [{ poNumber: 'REVISION-PO' }] } }];
  assert.equal(clientPoCounts(client).revision, 1);
  assert.equal(clientPoCounts(client).pending, 0);
});

test('Excel includes numeric client/service PO counts and a deduplicated approval summary sheet', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  const XLSX = require('../../frontend/node_modules/xlsx');
  const helpers = await import('../../frontend/src/features/clientMaster/clientPoStatus.mjs');
  const client = fixture();
  client.selectedLead.serviceSelections[0].firstAnnualReturnYearApplicable = '2025-26';
  client.selectedLead.assignments[0].poYearRows[0].poDate = '2026-07-22';
  client.selectedLead.assignments[0].poYearRows[0].poFinancialYear = '2026-27';
  client.selectedLead.assignments[0].poYearRows[0].annualReturnYear = '2025-26';
  client.selectedLead.assignments[0].poApprovalStatus = 'APPROVED';
  client.selectedLead.assignments[1].poApprovalStatus = 'PENDING';
  client.selectedLead.assignments[2].poApprovalStatus = 'REJECTED';
  const page = fs.readFileSync(path.join(__dirname, '../../frontend/src/features/clientMaster/ClientDirectoryView.jsx'), 'utf8');
  const start = page.indexOf('  async function exportExcel()');
  const source = page.slice(start, page.indexOf('\n  return (', start));
  let workbook;
  await vm.runInNewContext(`${source}\nexportExcel();`, {
    ...helpers, onExportAll: async () => [client, { ...client, _id: 'duplicate' }],
    XLSX: { utils: XLSX.utils, writeFile: value => { workbook = value; } },
    query: '', visibilityFilter: '', staffFilter: '', metricFilter: '', filteredClients: [], staff: [],
    readClientData: item => item.data, getClientUniqueId: item => item._id,
    getVisibilityStatus: () => 'LIVE', getAssignedName: () => '', clientLeadOwner: () => '',
    getAssignedStaffNames: () => [], getMsmeRows: () => []
  });
  const clients = XLSX.utils.sheet_to_json(workbook.Sheets.Clients);
  assert.equal(clients[0]['PO Approved Count'], 1);
  assert.equal(clients[0]['PO Pending Count'], 1);
  assert.equal(clients[0]['PO Rejected Count'], 1);
  assert.equal(clients[0]['PO Date'], '22-07-2026');
  assert.equal(clients[0]['Financial Year'], '2026-27');
  assert.equal(clients[0]['Service Financial Year'], '2025-26, 2026-27');
  const services = XLSX.utils.sheet_to_json(workbook.Sheets['Service PO Status']);
  assert.equal(services.length, 3);
  assert.equal(services[0]['PO Date'], '22-07-2026');
  assert.equal(services[0]['Financial Year'], '2026-27');
  assert.equal(services[0]['Service Financial Year'], '2025-26, 2026-27');
  assert.equal(services[0]['PO Financial Year'], '2026-27');
  assert.equal(services[0]['Annual Return Year'], '2025-26');
  assert.equal(services[1]['Financial Year'], 'Not Recorded');
  const summary = XLSX.utils.sheet_to_json(workbook.Sheets['PO Approval Summary']);
  assert.equal(summary.find(row => row['PO Status'] === 'Total')['PO Count'], 3);
});

test('all saved financial years are normalized, sorted and kept within their own service', async () => {
  const { financialYearLabels, clientFinancialYears, clientPoServices } = await import('../../frontend/src/features/clientMaster/clientPoStatus.mjs');
  assert.deepEqual(financialYearLabels(['FY 2026-2027', ['2025/26', '2025-26'], '2028–29', '2026-25', 'Not Recorded']), ['2025-26', '2026-27', '2028-29']);
  const client = fixture();
  client.selectedLead.serviceSelections[0].firstAnnualReturnYearApplicable = '2025-26';
  client.selectedLead.serviceSelections[1].financialYear = '2027-28';
  client.poApprovals = [{ payload: { assignedServiceId: 's1', poYearRows: [{ poFinancialYear: '2026-27', annualReturnYear: '2025-26' }, { poFinancialYear: '2028-29', annualReturnYear: '2027-28' }] } }];
  const services = clientPoServices(client);
  assert.deepEqual(services[0].poFinancialYears, ['2026-27', '2028-29']);
  assert.deepEqual(services[0].annualReturnYears, ['2025-26', '2027-28']);
  assert.deepEqual(services[1].financialYears, ['2027-28']);
  assert.deepEqual(services[2].financialYears, []);
  assert.deepEqual(clientFinancialYears(client), ['2025-26', '2026-27', '2027-28', '2028-29']);
});

test('PO dates define financial years at April boundaries without copying sibling dates or inventing dates', async () => {
  const { normalizedPoDates, poDatesLabel, poDateFinancialYears, clientPoServices, clientPoDates } = await import('../../frontend/src/features/clientMaster/clientPoStatus.mjs');
  const dates = normalizedPoDates(['2026-07-22', '22-07-2026', '2026-03-31', '2026-04-01', '', '2026-02-30']);
  assert.deepEqual(dates, ['2026-03-31', '2026-04-01', '2026-07-22']);
  assert.equal(poDatesLabel(dates), '31-03-2026, 01-04-2026, 22-07-2026');
  assert.deepEqual(poDateFinancialYears(dates), ['2025-26', '2026-27']);
  assert.equal(poDatesLabel([]), 'Not Recorded');
  const client = fixture();
  client.selectedLead.assignments[0].poYearRows[0].poDate = '2026-07-22';
  client.poApprovals = [{ payload: { assignedServiceId: 's1', poYearRows: [{ poDate: '2026-07-22' }, { poDate: '2025-08-10' }] } }];
  const services = clientPoServices(client);
  assert.deepEqual(services[0].poDateFinancialYears, ['2025-26', '2026-27']);
  assert.deepEqual(services[1].poDates, []);
  assert.deepEqual(clientPoDates(client), ['2025-08-10', '2026-07-22']);
});
test('one closed service makes company Yes while export shows Yes, No, No', async () => {
  const { companyPoClosed, clientPoServices, clientPoExportEntries } = await import('../../frontend/src/features/clientMaster/clientPoStatus.mjs');
  const client = fixture();
  assert.equal(companyPoClosed(client), true);
  assert.deepEqual(clientPoServices(client).map(s => [s.closed, s.received]), [[true, true], [false, false], [false, false]]);
  const entries = clientPoExportEntries([client, { ...client, _id: 'client-2', assignedServiceId: 's2' }, { ...client, _id: 'client-3', assignedServiceId: 's3' }]);
  assert.equal(entries.length, 3);
  assert.equal(entries[1].item._id, 'client-2');
});
test('service IDs take precedence over array order and lead closure cannot close siblings', async () => {
  const { clientPoServices } = await import('../../frontend/src/features/clientMaster/clientPoStatus.mjs');
  const client = fixture();
  client.selectedLead.closedAt = '2026-10-09';
  client.selectedLead.assignments.reverse();
  assert.deepEqual(clientPoServices(client).map(s => s.closed), [true, false, false]);
});
test('received PO does not imply closure; old positional and single-service closure supported', async () => {
  const { companyPoClosed, clientPoServices } = await import('../../frontend/src/features/clientMaster/clientPoStatus.mjs');
  const client = fixture();
  delete client.selectedLead.assignments[0].closedAt;
  assert.equal(companyPoClosed(client), false);
  assert.equal(clientPoServices(client)[0].received, true);
  client.selectedLead.assignments[0] = { closedByText: 'User' };
  assert.deepEqual(clientPoServices(client).map(s => s.closed), [true, false, false]);
  assert.equal(companyPoClosed({ selectedLead: { closedByText: 'User', serviceSelections: [{}] } }), true);
});
