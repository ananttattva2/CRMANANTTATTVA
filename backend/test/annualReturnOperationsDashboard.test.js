const test = require('node:test');
const assert = require('node:assert/strict');
const { buildRecords, buildDashboard, workflowState, categoryName, isAnnual } = require('../src/services/annualReturnOperationsDashboard');

function record(id, overrides = {}) {
  return {
    id, clientId: id, company: `Company ${id}`, leadId: `ATPL-${id}`, category: 'Plastic Waste',
    applicantType: 'PIBO', subType: 'Producer', years: ['2025-26'], assignedUserId: 'u1', assignedUser: 'Amit Sharma',
    teamId: 't1', team: 'Operations', managerId: 'm1', dueDate: '', yearStates: { '2025-26': { status: 'Pending', progress: 0 } },
    openPath: `/clients/${id}/{year}`, ...overrides
  };
}

test('Annual Return dashboard recognises saved service aliases and five supported waste categories', () => {
  assert.equal(isAnnual('Annual Return Filling'), true);
  assert.equal(isAnnual(' annual return '), true);
  assert.equal(isAnnual('New Registration'), false);
  assert.equal(categoryName('EPR - Plastic Waste'), 'Plastic Waste');
  assert.equal(categoryName('Electronic Waste'), 'E-Waste');
  assert.equal(categoryName('Waste Tyre'), 'Tyre Waste');
  assert.equal(categoryName('Used Oil'), 'Used Oil');
  assert.equal(categoryName('Battery Waste'), 'Battery Waste');
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
      _id: 'client-2', assignedServiceId: 'service-2',
      selectedLead: {
        _id: 'lead-2', company: 'Valid Client', leadCode: 'ATPL-2',
        serviceSelections: [{ assignedServiceId: 'service-2', servicesOffered: 'Annual Return Filling', eprCategory: 'Plastic Waste', applicantType: 'PIBO', subApplicantType: 'Producer', annualReturnYears: ['2025-26'] }],
        assignments: [{ assignedServiceId: 'service-2', poYearRows: [null] }]
      }
    }
  ];
  const records = buildRecords({ clients, users: [], teams: [], filings: new Map() });
  assert.equal(records.length, 1);
  assert.equal(records[0].company, 'Valid Client');
  assert.deepEqual(records[0].years, ['2025-26']);
});
