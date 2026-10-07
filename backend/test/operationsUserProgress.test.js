const test = require('node:test');
const assert = require('node:assert/strict');
const helpers = import('../../frontend/src/utils/operationsUserProgress.mjs');

test('operations PDF keeps the aggregate table and excludes client detail rows', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const page = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/AdminDashboard.jsx'), 'utf8');
  const pdf = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/utils/operationsReportPdf.mjs'), 'utf8');
  assert.match(page, /const open = !pdfMode && expandedUser === group\.id/);
  assert.match(page, /aggregate user metrics only; client names are excluded/);
  assert.doesNotMatch(page, /<OperationsTabRemarks/);
  assert.match(pdf, /\.operations-client-details,\.operations-user-detail-row/);
  assert.match(pdf, /\.operations-user-status-table/);
});

test('operations Excel export keeps one client row and puts every PO in a separate detail collection', async () => {
  const { buildOperationsWorkbookData } = await helpers;
  const groups = [{ name: 'Operations User', total: 1, complianceDone: 1, poDone: 1,
    milestones: { 48: 1, 72: 0, 96: 0 }, rows: [{ companyName: '=CLIENT', atplCode: 'ATPL-LEAD-1',
      eprCategory: 'Plastic', category: 'PIBO', subApplicantType: 'Brand Owner', hasPo: true,
      poDetails: { records: [{ poNo: 'PO-1', poDate: '2026-09-08', poEndDate: '2027-03-31',
        poFinancialYear: '2026-27', paymentTerm: '50% Advance', poAmount: 50000, fileUrl: 'https://example.com/po-1.pdf' },
      { poNo: 'PO-2', poDate: '2026-10-08', poEndDate: '2027-04-30',
        poFinancialYear: '2026-27', paymentTerm: 'On completion', poAmount: 25000, fileUrl: 'https://example.com/po-2.pdf' }] },
      client: { data: { basic: { contactPerson: 'A Person', sector: 'Food' }, otp: { email: 'a@example.com', mobile: '9999999999' } }, operationsSla: { approvalStatus: 'APPROVED', actionAt: '2026-09-09' } },
      sla: { 48: { breached: true, known: true, due: Date.parse('2026-09-10') }, 72: { breached: false, known: true, due: Date.parse('2026-09-11') }, 96: { breached: false, known: true, due: Date.parse('2026-09-12') } }
    }] }];
  const workbook = buildOperationsWorkbookData(groups, '2026-27');
  assert.equal(workbook.summary[0]['Assigned Clients'], 1);
  assert.equal(workbook.summary[0]['PO Received'], 1);
  assert.equal(workbook.clients.length, 1);
  assert.equal(workbook.clients[0]['Client Name'], "'=CLIENT");
  assert.equal(workbook.clients[0]['Contact Person'], 'A Person');
  assert.equal(workbook.clients[0]['PO Record Count'], 2);
  assert.equal(workbook.clients[0]['Total PO Amount (INR)'], 75000);
  assert.equal(workbook.clients[0]['PO Number(s)'], 'PO-1 | PO-2');
  assert.equal(workbook.clients[0]['48h+ Flag'], 'Red');
  assert.equal(workbook.clients[0]['Final Flag'], 'Green');
  assert.equal(workbook.poDetails.length, 2);
  assert.equal(workbook.poDetails[0]['PO Amount (INR)'], 50000);
  assert.equal(workbook.poDetails[1]['PO Number'], 'PO-2');
});

test('PO approval review displays quotation price only for system quotation rows', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const page = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/PendingApproval.jsx'), 'utf8');
  assert.match(page, /Quotation Price \(INR\)/);
  assert.match(page, /rows\.some\(\(row\) => row\.isSystemQuotation\)/);
  assert.match(page, /po\.basicAmountValue\.toLocaleString\('en-IN'\)/);
});

test('operations report includes active managers and excludes inactive operations users', async () => {
  const { buildOperationsProgressGroups } = await helpers;
  const users = [
    { _id: 'operator', name: 'Active operation', role: 'operation', isActive: true },
    { _id: 'manager', name: 'Active manager', role: 'manager', isActive: true },
    { _id: 'secondary-manager', name: 'Secondary manager', role: 'accounts', roles: ['manager'], isActive: true },
    { _id: 'inactive-op', name: 'Inactive operation', role: 'operation', isActive: false },
    { _id: 'inactive-manager', name: 'Inactive manager', role: 'manager', isActive: 'inactive' },
    { _id: 'inactive-zero', name: 'Inactive zero', role: 'operation', isActive: 0 }
  ];
  const groups = buildOperationsProgressGroups([{ id: 'client', client: { selectedLead: { assignedStaff: 'manager' }, serviceAllocations: { service: { userId: 'manager' } } } }], users, () => []);
  assert.deepEqual(groups.map((group) => group.id).sort(), ['manager', 'operator', 'secondary-manager']);
  assert.equal(groups.find((group) => group.id === 'manager').total, 1);
});

test('status dates use the real review timestamp and PO date', async () => {
  const { getOperationsStatusDates } = await helpers;
  const dates = getOperationsStatusDates({ hasPo: true, poDetails: { poDate: '2026-09-25' },
    client: { createdAt: '2026-01-01', submittedAt: '2026-09-20', operationsSla: {
      approvalStatus: 'APPROVED', actionAt: '2026-09-24T06:30:00Z'
    } } });
  assert.deepEqual(dates.compliance, { label: 'Reviewed', value: '2026-09-24T06:30:00Z' });
  assert.equal(dates.po.value, '2026-09-25');
});

test('pending compliance shows submission date, and missing PO dates are never fabricated', async () => {
  const { getOperationsStatusDates } = await helpers;
  const dates = getOperationsStatusDates({ hasPo: true, client: { submittedAt: '2026-09-20',
    operationsSla: { approvalStatus: 'PENDING' } } });
  assert.equal(dates.compliance.label, 'Submitted');
  assert.equal(dates.po.value, null);
  assert.equal(getOperationsStatusDates({ hasPo: false, poDetails: { poDate: '2026-01-01' } }).po.value, null);
});

test('report pagination keeps rows whole and covers every pixel without gaps', async () => {
  const { reportPageRanges } = await import('../../frontend/src/utils/operationsReportPdf.mjs');
  const pages = reportPageRanges(250, 100, [{ top: 90, bottom: 120 }, { top: 180, bottom: 210 }]);
  assert.deepEqual(pages, [{ start: 0, end: 90 }, { start: 90, end: 180 }, { start: 180, end: 250 }]);
  assert.deepEqual(reportPageRanges(250, 100, [{ top: 0, bottom: 220 }]),
    [{ start: 0, end: 100 }, { start: 100, end: 200 }, { start: 200, end: 250 }]);
});

const users = [{ _id: 'sonal', name: 'SONAL MORE', role: 'operation' },
  { _id: 'sales', name: 'Sales', role: 'sales' }, { _id: 'admin', name: 'Admin', role: 'admin' },
  { _id: 'other', name: 'Other', role: 'operation' }];

test('Operations client counts use service allocations and exclude admin/sales/creator', async () => {
  const { buildOperationsProgressGroups } = await helpers;
  const rows = [{ id: 'client1', hasPo: true, client: { selectedLead: { assignedStaff: 'sonal' }, serviceAllocations: {
    registration: { userId: 'sonal' }, annual: { userId: 'sonal' }
  }, adminControls: { assignedTo: 'admin', approvalStatus: 'PENDING' } } }];
  const groups = buildOperationsProgressGroups(rows, users, () => ['admin']);
  assert.equal(groups.length, 2);
  assert.equal(groups.find((group) => group.id === 'sonal').total, 1);
  assert.equal(groups.find((group) => group.id === 'sonal').complianceDone, 0);
  assert.equal(groups.find((group) => group.id === 'sonal').poDone, 1);
});

test('a client with multiple service allocations is counted once under its primary owner', async () => {
  const { buildOperationsProgressGroups } = await helpers;
  const row = { id: 'shared', user: users[0], client: { selectedLead: { assignedStaff: 'sonal' }, serviceAllocations: { a: 'sonal', b: { assignedUserId: 'other' } } } };
  const groups = buildOperationsProgressGroups([row, row], users, () => []);
  assert.equal(groups.find((group) => group.id === 'sonal').total, 1);
  assert.equal(groups.find((group) => group.id === 'other').total, 0);
  assert.equal(groups.reduce((sum, group) => sum + group.total, 0), 1);
});

test('original Sonal assignment overrides a historical Tushar service allocation', async () => {
  const { buildOperationsProgressGroups } = await helpers;
  const localUsers = [{ _id: 'sonal', name: 'Sonal More', role: 'operation' }, { _id: 'tushar', name: 'Tushar Gawas', role: 'operation' }];
  const row = { id: '20-microns', user: localUsers[0], companyName: '20 MICRONS NANO MINERALS LIMITED',
    client: { selectedLead: { assignedStaff: 'sonal' }, serviceAllocations: { old_service: { userId: 'tushar' }, current_service: { userId: 'sonal' } } } };
  const groups = buildOperationsProgressGroups([row], localUsers, () => ['tushar', 'sonal']);
  assert.equal(groups.find((group) => group.id === 'sonal').total, 1);
  assert.equal(groups.find((group) => group.id === 'tushar').total, 0);
});

test('permanent staff Sonal overrides Tushar stored as the assigned manager', async () => {
  const { buildOperationsProgressGroups, permanentStaffOwnerKeys } = await helpers;
  const localUsers = [{ _id: 'sonal', name: 'Sonal More', role: 'operation' }, { _id: 'tushar', name: 'Tushar Gawas', role: 'manager' }];
  const client = { assignedServiceId: 'annual-importer', selectedLead: { assignedTo: 'tushar', assignedToText: 'Tushar Gawas', assignments: [{
    assignedServiceId: 'annual-importer', assignedTo: 'tushar', assignedToText: 'Tushar Gawas', assignedStaff: 'sonal', assignedStaffText: 'Sonal More'
  }] } };
  assert.deepEqual(permanentStaffOwnerKeys(client).slice(0, 2), ['sonal', 'sonal more']);
  const groups = buildOperationsProgressGroups([{ id: '20-microns', user: localUsers[1], client }], localUsers, () => ['tushar']);
  assert.equal(groups.find((group) => group.id === 'sonal').total, 1);
  assert.equal(groups.find((group) => group.id === 'tushar').total, 0);
});

test('permanent-staff ownership is applied consistently across all clients', async () => {
  const { buildOperationsProgressGroups } = await helpers;
  const localUsers = [
    { _id: 'sonal', name: 'Sonal More', role: 'operation' },
    { _id: 'prachi', name: 'Prachi Chavan', role: 'operation' },
    { _id: 'tushar', name: 'Tushar Gawas', role: 'manager' }
  ];
  const clientRow = (id, staffId, staffName) => ({ id, user: localUsers[2], client: { assignedServiceId: `${id}-service`, selectedLead: {
    assignedTo: 'tushar', assignedToText: 'Tushar Gawas', assignments: [{ assignedServiceId: `${id}-service`, assignedTo: 'tushar', assignedStaff: staffId, assignedStaffText: staffName }]
  } } });
  const groups = buildOperationsProgressGroups([
    clientRow('client-a', 'sonal', 'Sonal More'),
    clientRow('client-b', 'sonal', 'Sonal More'),
    clientRow('client-c', 'prachi', 'Prachi Chavan')
  ], localUsers, () => ['tushar']);
  assert.equal(groups.find((group) => group.id === 'sonal').total, 2);
  assert.equal(groups.find((group) => group.id === 'prachi').total, 1);
  assert.equal(groups.find((group) => group.id === 'tushar').total, 0);
  assert.equal(groups.reduce((sum, group) => sum + group.total, 0), 3);
});

test('lead directory Assigned To uses permanent staff and Assigned By resolves the assigning manager', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const page = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/LeadGeneration.jsx'), 'utf8');
  assert.match(page, /resolveLeadStaffName\(item, staff\)/);
  assert.match(page, /resolveLeadAssignedBy\(item, staff\)/);
  assert.match(page, /row\?\.assignedStaff\?\.name, row\?\.assignedStaffText/);
});

test('legacy assignment names work when no service allocations exist', async () => {
  const { buildOperationsProgressGroups } = await helpers;
  const groups = buildOperationsProgressGroups([{ id: 'legacy', client: {} }], users, () => ['sonal more']);
  assert.equal(groups.find((group) => group.id === 'sonal').total, 0);
});

test('48/72/96 count actual overdue deadlines cumulatively at their boundaries', async () => {
  const { getOperationsSla } = await helpers;
  const due = Date.parse('2026-09-28T00:00:00Z');
  const record = { correctionDueAt: new Date(due).toISOString() };
  for (const [offset, expected] of [[-1, [false, false, false]], [0, [true, false, false]],
    [24, [true, true, false]], [48, [true, true, true]]]) {
    assert.deepEqual(Object.values(getOperationsSla(record, due + offset * 3600000)).map((item) => item.breached), expected);
  }
});

test('approved and recovered flags clear while permanent red flags persist', async () => {
  const { getOperationsSla } = await helpers;
  const base = { redFlagAt: '2026-01-01T00:00:00Z' };
  assert.equal(getOperationsSla({ ...base, approvalStatus: 'APPROVED' })[48].breached, false);
  assert.equal(getOperationsSla({ ...base, correctionStatus: 'RESOLVED' })[96].breached, false);
  assert.equal(getOperationsSla({ ...base, approvalStatus: 'APPROVED', reminderFlag: 'PERMANENT_RED' })[96].breached, true);
});

test('missing deadlines do not fabricate flags from client profile percentage or creation date', async () => {
  const { getOperationsSla } = await helpers;
  const sla = getOperationsSla({ createdAt: '2020-01-01', profilePercent: 96 });
  assert.equal(sla[48].known, false);
  assert.equal(sla[96].breached, false);
});

test('correction hours skip first and third Saturdays in IST and respect saved final deadline', async () => {
  const { addCorrectionHours, getOperationsSla } = await helpers;
  const { addClientCorrectionHours } = require('../src/utils/clientCorrectionDeadline');
  const start = '2026-10-02T06:00:00Z';
  assert.equal(addCorrectionHours(start, 96), addClientCorrectionHours(start, 96).getTime());
  const final = '2026-10-08T06:00:00Z';
  assert.equal(getOperationsSla({ correctionStartedAt: start, greenFlagDeadline: final })[96].due, Date.parse(final));
});

test('all compliance tab remarks survive workbook export with client and reviewer identity', async () => {
 const { buildOperationsWorkbookData } = await helpers;
 const longRemark = 'Check factory documents.\n' + 'Detailed note '.repeat(70);
 const rows = ['Client A', 'Client B'].map((companyName, index) => ({companyName, atplCode:`ATPL-${index}`, hasPo:false, sla:{}, client:{complianceReview:{finalRemarks:'Final note',sections:[
  {key:'companyOverview',label:'Company Overview',status:'VERIFIED',remarks:`Verified ${companyName}`,reviewedBy:{name:'Reviewer'},reviewedAt:'2026-10-06T10:00:00Z'},
  {key:'documents',label:'Documents',status:'CHANGES_REQUIRED',remarks:longRemark},
  {key:'cpcb',label:'CPCB Login Credentials',status:'NOT_REVIEWED',remarks:''}
 ]}}}));
 const result = buildOperationsWorkbookData([{name:'Operations User',total:2,complianceDone:0,poDone:0,milestones:{48:0,72:0,96:0},rows}]);
 assert.equal(result.tabRemarks.length,6);
 assert.equal(result.tabRemarks[0]['Client Name'],'Client A');
 assert.equal(result.tabRemarks[0]['Reviewed By'],'Reviewer');
 assert.equal(result.tabRemarks[1]['Tab remarks'],longRemark.trim());
 assert.equal(result.tabRemarks[3]['Tab remarks'],'Verified Client B');
 assert.match(result.clients[0]['Tab remarks'],/Company Overview.*Verified Client A/);
 assert.equal(result.clients[0]['Final Compliance Remarks'],'Final note');
 assert.equal(result.summary[0]['Compliance Tabs With Remarks'],4);
 const XLSX = require('../../frontend/node_modules/xlsx');
 const workbook = XLSX.utils.book_new();
 XLSX.utils.book_append_sheet(workbook,XLSX.utils.json_to_sheet(result.tabRemarks),'Compliance Tab Remarks');
 const roundtrip = XLSX.read(XLSX.write(workbook,{type:'buffer',bookType:'xlsx'}),{type:'buffer'});
 const exported = XLSX.utils.sheet_to_json(roundtrip.Sheets['Compliance Tab Remarks']);
 assert.equal(exported.length,6); assert.equal(exported[1]['Tab remarks'],longRemark.trim());
});
