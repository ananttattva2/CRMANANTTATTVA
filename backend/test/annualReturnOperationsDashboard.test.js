const test = require('node:test');
const assert = require('node:assert/strict');
const { buildRecords, buildDashboard, workflowState, categoryName, isAnnual, annualServiceName, activeAnnualReturnYear, purchaseSalesSummary } = require('../src/services/annualReturnOperationsDashboard');

function record(id, overrides = {}) {
  return {
    id, clientId: id, company: `Company ${id}`, leadId: `ATPL-${id}`, category: 'Plastic Waste',
    applicantType: 'PIBO', subType: 'Producer', serviceName: 'Annual Return', years: ['2025-26'], assignedUserId: 'u1', assignedUser: 'Amit Sharma',
    teamId: 't1', team: 'Operations', managerId: 'm1', dueDate: '', yearStates: { '2025-26': { status: 'Pending', progress: 0 } },
    openPath: `/clients/${id}/{year}`, ...overrides
  };
}

test('Annual Return dashboard recognises saved service aliases and five supported waste categories', () => {
  assert.equal(isAnnual('Annual Return Filling'), true);
  assert.equal(isAnnual(' annual return '), true);
  assert.equal(isAnnual('New Registration'), false);
  assert.equal(annualServiceName('Annual Return'), 'Annual Return');
  assert.equal(annualServiceName('Annual Return Filling'), 'Annual Return Filling');
  assert.equal(categoryName('EPR - Plastic Waste'), 'Plastic Waste');
  assert.equal(categoryName('Electronic Waste'), 'E-Waste');
  assert.equal(categoryName('Waste Tyre'), 'Tyre Waste');
  assert.equal(categoryName('Used Oil'), 'Used Oil');
  assert.equal(categoryName('Battery Waste'), 'Battery Waste');
});

test('active Annual Return year follows the previous financial year automatically', () => {
  assert.equal(activeAnnualReturnYear(new Date(2026, 10, 2, 12)), '2025-26');
  assert.equal(activeAnnualReturnYear(new Date(2027, 3, 1, 12)), '2026-27');
  assert.equal(activeAnnualReturnYear(new Date(2027, 2, 31, 12)), '2025-26');
  const future = buildDashboard([record('future', { years: ['2028-29'], yearStates: { '2028-29': { status: 'Pending', progress: 0 } } })], { year: '2028-29' });
  assert.equal(future.selectedYear, activeAnnualReturnYear());
  assert.equal(future.options.years.includes('2028-29'), false);
});

test('Annual Return workflow progress uses real approval stages instead of fabricated percentages', () => {
  assert.deepEqual(workflowState({}), { status: 'Pending', progress: 0 });
  assert.deepEqual(workflowState({ savedAt: new Date(), status: 'submitted', approvalWorkflow: { currentStage: 'manager' } }), { status: 'In Progress', progress: 50 });
  assert.deepEqual(workflowState({ status: 'compliance_pending', approvalWorkflow: { currentStage: 'compliance' } }), { status: 'In Progress', progress: 75 });
  assert.deepEqual(workflowState({ status: 'compliance_approved', approvalWorkflow: { currentStage: 'complete' } }), { status: 'Completed', progress: 100 });
});

test('dashboard preserves sibling categories while drilling down and paginates complete selection', () => {
  const rows = [
    record('1', { yearStates: { '2025-26': { status: 'Completed', progress: 100 } } }),
    record('2', { subType: 'Importer' }),
    record('3', { category: 'E-Waste', applicantType: 'Producer', subType: 'Recycler' })
  ];
  const result = buildDashboard(rows, { year: '2025-26', category: 'Plastic Waste', applicantType: 'PIBO', subType: 'Producer', limit: 10 });
  assert.equal(result.summary.total, 1);
  assert.equal(result.records[0].id, '1');
  assert.equal(result.categories.find(row => row.label === 'Plastic Waste').count, 2);
  assert.equal(result.categories.find(row => row.label === 'E-Waste').count, 1);
  assert.equal(result.applicantTypes.find(row => row.label === 'PIBO').count, 2);
  assert.equal(result.subTypes.find(row => row.label === 'Producer').count, 1);
});

test('dashboard reconciles distinct totals and separately counts both saved Annual Return names for PIBO', () => {
  const rows = [
    record('1', { serviceName: 'Annual Return' }),
    record('2', { serviceName: 'Annual Return Filling', subType: 'Importer' }),
    record('3', { category: 'E-Waste', applicantType: 'Producer', subType: 'Recycler', serviceName: 'Annual Return Filling' })
  ];
  const global = buildDashboard(rows, { year: '2025-26' });
  assert.equal(global.summary.total, 3);
  assert.equal(global.categories.reduce((total, row) => total + row.count, 0), global.summary.total);
  assert.equal(global.summary.completed + global.summary.inProgress + global.summary.pending, global.summary.total);

  const plastic = buildDashboard(rows, { year: '2025-26', category: 'Plastic Waste' });
  const pibo = plastic.applicantTypes.find(row => row.label === 'PIBO');
  assert.equal(pibo.count, 2);
  assert.deepEqual(pibo.serviceBreakdown, [
    { label: 'Annual Return', count: 1 },
    { label: 'Annual Return Filling', count: 1 }
  ]);
});

test('overdue is a deadline condition and does not overwrite workflow status', () => {
  const result = buildDashboard([record('1', { dueDate: '2025-01-01', yearStates: { '2025-26': { status: 'In Progress', progress: 50 } } })], { year: '2025-26', status: 'Overdue' });
  assert.equal(result.summary.overdue, 1);
  assert.equal(result.records[0].status, 'In Progress');
  assert.equal(result.records[0].overdue, true);
});

test('legacy malformed assignment arrays do not crash or hide later valid services', () => {
  const clients = [
    { _id: 'bad', assignedServiceId: 'bad-service', selectedLead: { _id: 'bad-lead', serviceSelections: { servicesOffered: 'Annual Return' }, assignments: 'invalid' } },
    {
      _id: 'client-2', assignedServiceId: 'service-2', workflowStatus: 'submitted', data: { importMeta: { uniqueId: 'ATPL-LEAD-0548' }, cpcb: { status: 'Approved' } },
      selectedLead: {
        _id: 'lead-2', company: 'Valid Client', leadCode: 'ATPL-2', status: 'Closed',
        serviceSelections: [{ assignedServiceId: 'service-2', servicesOffered: 'Annual Return Filling', eprCategory: 'Plastic Waste', applicantType: 'PIBO', subApplicantType: 'Producer', annualReturnYears: ['2025-26'] }],
        assignments: [{ assignedServiceId: 'service-2', assignedTo: 'manager', assignedStaff: 'u1', poStatus: 'received', poYearRows: [{ annualReturnYear: '2025-26' }] }]
      }
    }
  ];
  const records = buildRecords({ clients, users: [{ _id: 'u1', name: 'Operations User', role: 'operation' }], teams: [], filings: new Map() });
  assert.equal(records.length, 1);
  assert.equal(records[0].company, 'Valid Client');
  assert.equal(records[0].uniqueId, 'ATPL-0548');
  assert.deepEqual(records[0].years, ['2025-26']);
});

test('closed Annual Return service remains in total while permanent staff assignment is pending', () => {
  const client = {
    _id: 'pending-staff-client', assignedServiceId: 'annual-service', workflowStatus: 'submitted',
    data: { cpcb: { status: 'Approved' } },
    selectedLead: {
      _id: 'lead-pending-staff', company: 'SARVOTTAM POLYMERS PVT. LTD.', status: 'Closed',
      serviceSelections: [{ assignedServiceId: 'annual-service', servicesOffered: 'Annual Return Filling', eprCategory: 'Plastic Waste', applicantType: 'PIBO', subApplicantType: 'Importer' }],
      assignments: [{ assignedServiceId: 'annual-service', assignedTo: 'manager-1', closedByText: 'Sales User', poStatus: 'received', poYearRows: [{ annualReturnYear: '2025-26', poNumber: 'PO-1' }] }]
    }
  };
  const records = buildRecords({ clients: [client], users: [], teams: [], filings: new Map() });
  const dashboard = buildDashboard(records, { year: '2025-26', search: 'SARVOTTAM' });
  assert.equal(dashboard.summary.total, 1);
  assert.equal(dashboard.summary.pending, 1);
  assert.equal(dashboard.records[0].assignedUser, 'Unassigned');
  assert.equal(dashboard.records[0].staffAssignmentPending, true);
});

test('Operations records use the same Annual Return applicability gates as Application Status Summary', () => {
  const user = { _id: 'u1', name: 'Operations User', role: 'operation' };
  const eligible = (id, subType = 'Producer', overrides = {}) => ({
    _id: id, assignedServiceId: id, workflowStatus: 'submitted',
    data: { importMeta: { uniqueId: `ATPL-LEAD-${id.slice(-4)}` }, cpcb: { status: 'Approved' } },
    selectedLead: {
      _id: `lead-${id}`, company: 'Shared Company', leadCode: `ATPL-LEAD-${id.slice(-4)}`, status: 'Closed',
      serviceSelections: [{ assignedServiceId: id, servicesOffered: 'Annual Return', eprCategory: 'Plastic Waste', applicantType: 'PIBO', subApplicantType: subType, plantUnit: 'Unit 1', annualReturnYears: ['2027-28'] }],
      assignments: [{ assignedServiceId: id, assignedTo: 'manager', assignedStaff: 'u1', poStatus: 'received', poYearRows: [{ annualReturnYear: '2025-26' }] }]
    },
    ...overrides
  });
  const duplicate = eligible('service-0002');
  duplicate.selectedLead.serviceSelections[0].servicesOffered = 'Annual Return Filling';
  const importer = eligible('service-0003', 'Importer');
  const noPo = eligible('service-0004', 'Brand Owner');
  noPo.selectedLead.assignments[0].poStatus = 'pending';
  noPo.selectedLead.assignments[0].poYearRows = [];
  const notApproved = eligible('service-0005', 'Recycler');
  notApproved.data.cpcb.status = 'Under Review';
  const records = buildRecords({ clients: [eligible('service-0001'), duplicate, importer, noPo, notApproved], users: [user], teams: [], filings: new Map() });
  assert.equal(records.length, 2);
  assert.deepEqual(records.map(row => row.subType).sort(), ['Importer', 'Producer']);
  assert(records.every(row => row.years.length === 1 && row.years[0] === '2025-26'));
  assert(records.every(row => row.plantUnit === 'Unit 1'));
});

test('Purchase and Sales summary uses the same eligible Annual Return applications and all workflow stages', () => {
  const rows = [
    record('c1', { sourceClientIds: ['c1'], slaReceived: true }),
    record('c2', { sourceClientIds: ['c2'], slaReceived: false })
  ];
  const completeWorkflow = clientId => ({
    clientId, financialYear: '2025-26',
    checklist: ['Data Explained', 'Data Format Sent', 'Received from client', 'Ready to upload', 'Client Approval on data'].map(particular => ({ particular, yesNo: 'Yes' })),
    baseUpload: { importStatus: 'Imported' }, portalUpload: { importStatus: 'Imported' },
    managerVerificationStatus: 'Approved', complianceVerificationStatus: 'Approved'
  });
  const result = purchaseSalesSummary(rows, '2025-26', {}, [completeWorkflow('c1')], [completeWorkflow('c1')]);
  assert.deepEqual(result.summary, { allocated: 2, slaReceived: 1, slaNotReceived: 1, purchaseComplete: 1, salesComplete: 1, fullyComplete: 1 });
  assert.equal(result.purchase.length, 8);
  assert.equal(result.purchase[0].complete, 1);
  assert.equal(result.purchase[0].pending, 1);
  assert.equal(result.users[0].allocated, 2);
  assert.equal(result.users[0].completion, 50);
  assert.equal(result.users[0].clients[0].plantUnit, rows[0].plantUnit);
});

test('Purchase and Sales summary reflects the AR Compliance manager decision', () => {
  const rows = [record('c1', { sourceClientIds: ['c1'] })];
  const ready = {
    clientId: 'c1', financialYear: '2025-26',
    baseUpload: { importStatus: 'Imported' }, portalUpload: { importStatus: 'Imported' },
    managerVerificationStatus: 'Pending', complianceVerificationStatus: 'Pending'
  };
  const review = { client: 'c1', financialYear: '2025-26', managerStatus: 'APPROVED', status: 'PENDING' };
  const result = purchaseSalesSummary(rows, '2025-26', {}, [ready], [ready], [review]);
  assert.equal(result.purchase[6].complete, 1);
  assert.equal(result.sales[6].complete, 1);
  assert.equal(result.purchase[7].pending, 1);
  assert.equal(result.users[0].purchaseManagerReviewed, 1);
  assert.equal(result.users[0].salesManagerReviewed, 1);
  assert.equal(result.users[0].purchaseComplete, 0);
});

test('Purchase and Sales summary treats Compliance rejection as terminal', () => {
  const rows = [record('c1', { sourceClientIds: ['c1'] })];
  const ready = {
    clientId: 'c1', financialYear: '2025-26',
    baseUpload: { importStatus: 'Imported' }, portalUpload: { importStatus: 'Imported' },
    managerVerificationStatus: 'Approved', complianceVerificationStatus: 'Pending'
  };
  const review = { client: 'c1', financialYear: '2025-26', managerStatus: 'APPROVED', status: 'REJECTED' };
  const result = purchaseSalesSummary(rows, '2025-26', {}, [ready], [ready], [review]);
  assert.equal(result.purchase[6].complete, 0);
  assert.equal(result.purchase[6].rejected, 1);
  assert.equal(result.purchase[7].pending, 0);
  assert.equal(result.purchase[7].rejected, 1);
  assert.equal(result.users[0].purchaseManagerReviewed, 0);
  assert.equal(result.users[0].salesManagerReviewed, 0);
  assert.equal(result.users[0].purchaseComplete, 0);
  assert.equal(result.users[0].fullyComplete, 0);
});
