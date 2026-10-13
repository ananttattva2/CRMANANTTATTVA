const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { analyzeClientMasterData, buildUserProductivityReport, canViewUserWorkReport, clientSectionAnalysis, deduplicateClientWorkRows, getClientApplicantIdentity, productivityScore } = require('../src/services/userProductivityReport');

function user(id, name) {
  return { _id: id, name, email: `${name.toLowerCase()}@example.com`, role: 'operation', isActive: true, lastLogin: new Date('2026-08-08T04:30:00.000Z') };
}

test('productivity timeline retains India midnight boundaries across a large audit batch', () => {
  const activities = Array.from({ length: 10000 }, (_, index) => ({
    userId: 'u-a', action: 'view', module: 'leads',
    occurredAt: index % 2 ? '2026-10-08T18:30:00.000Z' : '2026-10-08T18:29:59.000Z'
  }));
  const report = buildUserProductivityReport({
    users: [user('u-a', 'User A')], sessions: [], activities,
    leads: [], clients: [], ticketStats: [], period: { from: '2026-10-08', to: '2026-10-09' }
  });
  assert.equal(report.summary.actions, 10000);
  assert.deepEqual(report.users[0].timeline.map(({ date, actions }) => ({ date, actions })), [
    { date: '2026-10-09', actions: 5000 }, { date: '2026-10-08', actions: 5000 }
  ]);
});

test('temporary captured counts include converted records and stay separate from permanent ownership', () => {
  const report = buildUserProductivityReport({
    users: [user('u-a', 'User A'), user('u-b', 'User B'), user('u-c', 'User C')],
    sessions: [], activities: [], clients: [], ticketStats: [],
    leads: [
      { createdBy: 'u-a', generatedForUser: 'u-b', closedAt: '2026-10-05' },
      { createdBy: 'u-b', status: 'Open' }
    ],
    temporaryLeads: [
      { createdBy: 'u-a', status: 'DRAFT' },
      { createdBy: { _id: 'u-a' }, status: 'CONVERTED' },
      { createdByEmail: 'user b@example.com', status: 'DRAFT' },
      { createdBy: 'unknown', status: 'DRAFT' }
    ],
    period: { from: '2026-08-01', to: '2026-10-06' }
  });
  const a = report.users.find((row) => String(row.id) === 'u-a');
  const b = report.users.find((row) => String(row.id) === 'u-b');
  const c = report.users.find((row) => String(row.id) === 'u-c');
  assert.equal(a.temporaryLeads, 2);
  assert.equal(a.totalLeads, 0);
  assert.equal(b.temporaryLeads, 1);
  assert.equal(b.totalLeads, 2);
  assert.equal(b.openLeads, 1);
  assert.equal(b.closedLeads, 1);
  assert.equal(c.temporaryLeads, 0);
});

test('ticket aggregation maps 5, 0, and 2 raised tickets to the correct users and KPI', () => {
  const report = buildUserProductivityReport({
    users: [user('u-a', 'User A'), user('u-b', 'User B'), user('u-c', 'User C')],
    sessions: [], activities: [], leads: [],
    ticketStats: [
      { _id: 'u-a', total: 5, open: 3, resolved: 2 },
      { _id: 'u-c', total: 2, open: 0, resolved: 2 }
    ],
    period: { from: '2026-08-07', to: '2026-08-08' },
    now: new Date('2026-08-08T06:00:00.000Z')
  });
  const byName = new Map(report.users.map((row) => [row.name, row]));
  assert.deepEqual(byName.get('User A').tickets, { total: 5, open: 3, resolved: 2 });
  assert.deepEqual(byName.get('User B').tickets, { total: 0, open: 0, resolved: 0 });
  assert.deepEqual(byName.get('User C').tickets, { total: 2, open: 0, resolved: 2 });
  assert.equal(report.summary.supportTickets, 7);
  assert.equal(report.summary.openTickets, 3);
  assert.equal(report.summary.resolvedTickets, 4);
});

test('existing 100-point productivity formula remains unchanged', () => {
  assert.equal(productivityScore({ openSeconds: 100, activeSeconds: 60, activityCount: 99, closedLeads: 2 }), 56);
  assert.equal(productivityScore({ openSeconds: 0, activeSeconds: 0, activityCount: 0, closedLeads: 0 }), 0);
});

test('report service uses grouped ticket aggregation instead of per-user queries', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.resolve(__dirname, '../src/services/userProductivityReport.js'), 'utf8');
  assert.match(source, /Promise\.all\(\[/);
  assert.match(source, /SupportTicket\.aggregate\(\[/);
  assert.match(source, /\$group:\s*\{/);
  assert.match(source, /_id: '\$createdBy'/);
  assert.match(source, /Lead\.find\(\{ \.\.\.ownerFilter, createdAt \}\)/);
});

test('productivity report limits heavy telemetry queries and falls back per dataset', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.resolve(__dirname, '../src/services/userProductivityReport.js'), 'utf8');
  assert.match(source, /async function reportQuery\(label, query, fallback = \[\]\)/);
  assert.match(source, /\.limit\(5000\)\.maxTimeMS\(15000\)/);
  assert.match(source, /\.limit\(10000\)\.maxTimeMS\(15000\)/);
  assert.match(source, /REPORT_CACHE_TTL_MS = 60 \* 1000/);
  assert.match(source, /managerId: entityId\(team\.manager\)/);
  assert.match(source, /memberIds: \(team\.members \|\| \[\]\)\.map\(entityId\)\.filter\(Boolean\)/);
});

test('productivity rows include manager hierarchy and Client Master completion totals', () => {
  const report = buildUserProductivityReport({
    users: [{ ...user('manager-1', 'Tushar Manager'), role: 'manager' }, { ...user('user-1', 'Prachi User'), managerId: 'manager-1' }],
    sessions: [], activities: [], leads: [], ticketStats: [],
    clients: [{ createdBy: 'user-1', data: { companyOverview: { companyName: 'Example Pvt Ltd' } } }],
    period: { from: '2026-08-07', to: '2026-08-08' }, now: new Date('2026-08-08T06:00:00.000Z')
  });
  const member = report.users.find((row) => row.name === 'Prachi User');
  assert.equal(String(member.managerId), 'manager-1');
  assert.equal(member.clientMasters, 1);
  assert.ok(member.clientFieldsFilled > 0);
  assert.ok(member.clientFieldsMissing > 0);
  assert.ok(member.clientCompletionPercentage > 0 && member.clientCompletionPercentage < 100);
});

test('Operation MIS includes draft and submitted Client Masters as separate totals', () => {
  const report = buildUserProductivityReport({
    users: [user('operation-1', 'Operation User')],
    sessions: [], activities: [], leads: [], ticketStats: [],
    clients: [
      { createdBy: 'operation-1', workflowStatus: 'draft', data: {} },
      { createdBy: 'operation-1', workflowStatus: 'draft', data: {} },
      { createdBy: 'operation-1', workflowStatus: 'submitted', data: {} }
    ],
    period: { from: '2026-08-01', to: '2026-08-18' }, now: new Date('2026-08-18T06:00:00.000Z')
  });
  const operation = report.users[0];
  assert.equal(operation.clientMasters, 3);
  assert.equal(operation.draftClients, 2);
  assert.equal(operation.submittedClients, 1);
});

test('Operation MIS totals exclude a stale draft when the same client service is submitted', () => {
  const shared = {
    createdBy: 'operation-1', selectedLead: 'lead-asia',
    data: { basic: { clientLegalName: 'ASIA BULK SACKS PRIVATE LIMITED', eprCategory: 'EPR - Plastic Waste' }, selectedLeadSnapshot: { applicantType: 'PIBO' } }
  };
  const report = buildUserProductivityReport({
    users: [user('operation-1', 'Operation User')], sessions: [], activities: [], ticketStats: [],
    leads: [{ _id: 'lead-asia', company: 'ASIA BULK SACKS PRIVATE LIMITED', applicantType: 'PIBO' }],
    clients: [
      { ...shared, _id: 'draft-importer', workflowStatus: 'draft', updatedAt: '2026-08-20T10:00:00.000Z', data: { ...shared.data, basic: { ...shared.data.basic, piboCategory: 'Importer' } } },
      { ...shared, _id: 'submitted-importer', workflowStatus: 'submitted', updatedAt: '2026-08-21T10:00:00.000Z', data: { ...shared.data, basic: { ...shared.data.basic, piboCategory: 'Importer' } } },
      { ...shared, _id: 'draft-producer', workflowStatus: 'draft', updatedAt: '2026-08-21T11:00:00.000Z', data: { ...shared.data, basic: { ...shared.data.basic, piboCategory: 'Producer' } } }
    ],
    period: { from: '2026-08-01', to: '2026-08-21' }, now: new Date('2026-08-21T12:00:00.000Z')
  });
  const operation = report.users[0];
  assert.equal(operation.clientMasters, 2);
  assert.equal(operation.draftClients, 1);
  assert.equal(operation.submittedClients, 1);
});

test('Operation MIS database query does not exclude draft Client Masters', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.resolve(__dirname, '../src/services/userProductivityReport.js'), 'utf8');
  assert.match(source, /Client\.find\(\{ \.\.\.ownerFilter, createdAt \}\)/);
  assert.doesNotMatch(source, /Client\.find\(\{ \.\.\.ownerFilter, workflowStatus: 'submitted'/);
});

test('Sales MIS Total Leads follows the stable Yourself or Other User owner', () => {
  const gaurav = { ...user('user-gaurav', 'Gaurav Chandra'), crmUserId: 'CRM-42', email: 'gaurav@example.com', role: 'sales' };
  const leads = [
    { generatedForUser: 'user-gaurav', status: 'Open' },
    { generatedForName: '  Gaurav   Chandra ', status: 'Open' },
    { generatedForEmail: 'GAURAV@EXAMPLE.COM', closedAt: new Date() },
    { generatedForUser: 'user-gaurav', status: 'Closed' },
    { createdBy: 'user-gaurav', status: 'Open' },
    { generatedForName: 'Another User', createdBy: 'user-gaurav', status: 'Open' }
  ];
  const report = buildUserProductivityReport({ users: [gaurav], sessions: [], activities: [], leads, clients: [], ticketStats: [], period: { from: '2026-08-08', to: '2026-08-14' } });
  assert.equal(report.users[0].totalLeads, 5);
  assert.equal(report.users[0].closedLeads, 2);
  assert.equal(report.users[0].openLeads, 3);
});

test('company drill-down calculates section completion without exposing sensitive fields', () => {
  const sections = clientSectionAnalysis({ basic: { clientLegalName: 'ABC Ltd', tradeName: '' }, cpcb: { loginId: 'abc', loginPassword: 'secret' } });
  const basic = sections.find((section) => section.name === 'Basic');
  const cpcb = sections.find((section) => section.name === 'Cpcb');
  assert.deepEqual({ filled: basic.filled, missing: basic.missing, percentage: basic.percentage }, { filled: 1, missing: 1, percentage: 50 });
  assert.deepEqual({ filled: cpcb.filled, missing: cpcb.missing, total: cpcb.total }, { filled: 1, missing: 0, total: 1 });
});

test('super admin sales drill-down is wired to API, status filters, risks and report download', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const page = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/components/dashboard/UserWorkDrilldown.jsx'), 'utf8');
  const routes = fs.readFileSync(path.resolve(__dirname, '../src/routes/auth.js'), 'utf8');
  assert.match(routes, /superadmin\/users\/:id\/work-report/);
  assert.match(page, /Search company/);
  assert.match(page, /Open Leads/);
  assert.match(page, /Follow-up Timeline/);
  assert.match(page, /Missed Follow-ups/);
  assert.match(page, /Red Flags/);
  assert.match(page, /\['Open','Closed'\]/);
  assert.match(page, /Download Report/);
  assert.match(page, /fixed inset-0 z-\[130\] flex flex-col/);
  assert.match(page, /CompanyInsight/);
  assert.match(page, /Rows per page/);
  assert.match(page, /pageSize/);
  assert.match(page, /Next Action/);
  assert.match(page, /Owner/);
  assert.match(page, /Client Master Analysis/);
  assert.match(page, /Applicant:/);
  assert.match(page, /Sub-applicant:/);
  assert.match(page, /\["all","draft","submitted"\]/);
  assert.match(page, /Filled vs Missing Data/);
  assert.match(page, /Section-wise Completion/);
  assert.match(page, /Manager Team/);
});

test('resolved sales follow-ups show green before 48 hours and retain red after the threshold', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const page = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/AdminDashboard.jsx'), 'utf8');
  const styles = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/styles/modules/11-final-overrides.css'), 'utf8');
  assert.match(page, /key: 'resolved-green', label: 'Resolved Green'/);
  assert.match(page, /key: 'resolved-red', label: 'Resolved Red Flag'/);
  assert.match(page, /if \(delta < 30 \* 60 \* 1000\) return null/);
  assert.match(page, /if \(delta < 48 \* 60 \* 60 \* 1000\) return \{ key: 'resolved-green'/);
  assert.match(page, /key: 'overdue-24', label: '24 hours overdue'/);
  assert.match(page, /counts\['permanent-red'\] \|\| 0/);
  assert.doesNotMatch(page, /key: 'red-flag', label: 'Red Flag'/);
  assert.match(page, /counts\['resolved-red'\]/);
  assert.match(page, /counts\['resolved-green'\]/);
  assert.match(page, /<CheckCircle2 aria-hidden="true" \/>/);
  assert.match(styles, /\.red-flag-stage\.is-resolved-red/);
  assert.match(styles, /\.red-flag-stage\.is-resolved-green/);
});

test('Operations MIS work-report access is limited to administrators and the assigned management hierarchy', () => {
  const manager = { _id: 'manager-1', role: 'manager' };
  const operationHead = { _id: 'head-1', role: 'operation head' };
  const teams = [{ manager: 'manager-1', operationHead: 'head-1', members: ['operation-1', 'operation-2'] }];
  assert.equal(canViewUserWorkReport({ requester: manager, targetUserId: 'manager-1', operationTeams: teams }), true);
  assert.equal(canViewUserWorkReport({ requester: manager, targetUserId: 'operation-1', operationTeams: teams }), true);
  assert.equal(canViewUserWorkReport({ requester: manager, targetUserId: 'unrelated-user', operationTeams: teams }), false);
  assert.equal(canViewUserWorkReport({ requester: operationHead, targetUserId: 'operation-2', operationTeams: teams }), true);
  assert.equal(canViewUserWorkReport({ requester: { _id: 'operation-1', role: 'operation' }, targetUserId: 'operation-1', operationTeams: teams }), false);
  assert.equal(canViewUserWorkReport({ requester: { _id: 'admin-1', role: 'admin' }, targetUserId: 'unrelated-user' }), true);
});

test('Operations MIS work-report access matches MongoDB ObjectIds with URL string ids', () => {
  const managerId = new mongoose.Types.ObjectId();
  const memberId = new mongoose.Types.ObjectId();
  const unrelatedId = new mongoose.Types.ObjectId();
  const requester = { _id: managerId, role: 'manager' };
  const teams = [{ manager: managerId, members: [memberId] }];
  assert.equal(canViewUserWorkReport({ requester, targetUserId: managerId.toString(), operationTeams: teams }), true);
  assert.equal(canViewUserWorkReport({ requester, targetUserId: memberId.toString(), operationTeams: teams }), true);
  assert.equal(canViewUserWorkReport({ requester, targetUserId: unrelatedId.toString(), operationTeams: teams }), false);
});

test('Client Master rows resolve applicant identity from current and legacy records', () => {
  const current = getClientApplicantIdentity({
    client: { assignedServiceId: 'svc-brand', data: { basic: { piboCategory: 'Brand Owner' }, selectedLeadSnapshot: { assignedServiceId: 'svc-brand' } } },
    lead: { applicantType: 'PIBO', serviceSelections: [
      { assignedServiceId: 'svc-import', applicantType: 'PIBO', subApplicantType: 'Importer' },
      { assignedServiceId: 'svc-brand', applicantType: 'PIBO', subApplicantType: 'Brand Owner' }
    ] }
  });
  assert.deepEqual(current, { applicantType: 'PIBO', subApplicantType: 'Brand Owner' });

  const legacy = getClientApplicantIdentity({
    client: { data: { basic: { piboCategory: 'Importer' }, selectedLeadSnapshot: { piboParent: 'PIBO' } } }
  });
  assert.deepEqual(legacy, { applicantType: 'PIBO', subApplicantType: 'Importer' });
});

test('submitted Client Master service suppresses its stale draft duplicate without hiding another service', () => {
  const rows = [
    { id: 'draft-importer', leadId: 'lead-1', company: 'ASIA BULK SACKS PRIVATE LIMITED', applicantType: 'PIBO', subApplicantType: 'Importer', serviceCategory: 'EPR - Plastic Waste', status: 'draft', updatedAt: '2026-08-20T10:00:00.000Z' },
    { id: 'draft-producer', leadId: 'lead-1', company: 'ASIA BULK SACKS PRIVATE LIMITED', applicantType: 'PIBO', subApplicantType: 'Producer', serviceCategory: 'EPR - Plastic Waste', status: 'draft', updatedAt: '2026-08-20T11:00:00.000Z' },
    { id: 'submitted-importer', leadId: 'lead-1', company: 'ASIA BULK SACKS PRIVATE LIMITED', applicantType: 'PIBO', subApplicantType: 'Importer', serviceCategory: 'EPR - Plastic Waste', status: 'submitted', updatedAt: '2026-08-21T10:00:00.000Z' }
  ];

  const result = deduplicateClientWorkRows(rows);
  assert.deepEqual(result.map((row) => row.id), ['submitted-importer', 'draft-producer']);
  assert.equal(result.filter((row) => row.status === 'draft').length, 1);
  assert.equal(result.filter((row) => row.status === 'submitted').length, 1);
});

test('full company analysis covers every Client Master section and respects applicability', () => {
  const notApplicable = analyzeClientMasterData({ compliance: { msmeApplicable: 'No' }, cpcb: { linkedToCommonPortal: 'No' } });
  assert.ok(notApplicable.totalCount > 50);
  assert.ok(!notApplicable.missingFields.some((label) => label.includes('MSME 1')));
  assert.ok(!notApplicable.missingFields.includes('CEPR Password'));
  const applicable = analyzeClientMasterData({ compliance: { msmeApplicable: 'Yes' }, cpcb: { linkedToCommonPortal: 'Yes' } });
  assert.ok(applicable.missingFields.includes('MSME 1 Udyam Number'));
  assert.ok(applicable.missingFields.includes('CEPR Password'));
  assert.ok(applicable.sections.some((section) => section.name === 'Authorized Person Details'));
});

test('Client Master MIS excludes non-applicable PWP, Importer, CTE and process diagram fields', () => {
  const pwp = analyzeClientMasterData({
    basic: { piboCategory: 'Recycler' },
    selectedLeadSnapshot: { applicantType: 'PWP' },
    compliance: { msmeApplicable: 'No' },
    cpcb: { linkedToCommonPortal: 'No' }
  });
  assert.ok(!pwp.missingFields.includes('CIN Number'));
  assert.ok(!pwp.missingFields.includes('FACTORY LICENSE Number'));
  assert.ok(!pwp.missingFields.includes('IEC Number'));
  assert.ok(!pwp.missingFields.includes('DIC DCSSI Number'));

  const linkedPwp = analyzeClientMasterData({
    basic: { piboCategory: 'PWP' },
    selectedLeadSnapshot: { applicantType: 'PWP' },
    compliance: { msmeApplicable: 'No' },
    cpcb: { linkedToCommonPortal: 'Yes' }
  });
  assert.ok(!linkedPwp.missingFields.includes('CPCB Registration Number'));
  assert.ok(!linkedPwp.missingFields.includes('Application Number'));
  assert.ok(linkedPwp.missingFields.includes('CEPR User ID'));

  const importer = analyzeClientMasterData({
    basic: { piboCategory: 'Importer' },
    compliance: { msmeApplicable: 'No' },
    cpcb: { linkedToCommonPortal: 'No', processDiagramRequired: 'No' }
  });
  assert.ok(!importer.sections.some((section) => section.name === 'CTE & CTO / CCA'));
  assert.ok(!importer.missingFields.some((label) => label.startsWith('Process Diagram')));
  assert.ok(importer.filledFields.includes('Process Flow Diagram Required'));

  const ctoOnly = analyzeClientMasterData({
    cte: {
      cteApplicable: 'No',
      numberOfPlantsLocations: '1',
      plantWiseDetails: [{
        plantName: 'Plant 1', ctoOrderNo: 'CTO-1', ctoIssueDate: '2026-01-01',
        ctoValidDate: '2027-01-01', ctoDocument: { url: 'cto.pdf' },
        ctoProductRows: [{ productName: 'Product', quantity: '10' }]
      }]
    },
    compliance: { msmeApplicable: 'No' },
    cpcb: { linkedToCommonPortal: 'No' }
  });
  const consent = ctoOnly.sections.find((section) => section.name === 'CTE & CTO / CCA');
  assert.equal(consent.percentage, 100);
  assert.ok(!ctoOnly.missingFields.some((label) => label.includes('CTE Consent') || label.includes('CTE Document')));
});

test('Company Type and applicant category drive the requested document applicability matrix', () => {
  const analyze = (piboCategory, companyType, compliance = {}) => analyzeClientMasterData({
    basic: { piboCategory, companyType },
    compliance: { msmeApplicable: 'No', ...compliance },
    cpcb: { linkedToCommonPortal: 'No', processDiagramRequired: 'No' }
  }).missingFields;

  const producerCompany = analyze('Producer', 'Private Limited');
  assert.ok(!producerCompany.includes('IEC Number'));
  assert.ok(!producerCompany.includes('DIC DCSSI Number'));
  assert.ok(producerCompany.includes('CIN Number'));

  const producerFirm = analyze('Producer', 'LLP');
  assert.ok(!producerFirm.includes('CIN Number'));
  assert.ok(!producerFirm.includes('IEC Number'));
  assert.ok(!producerFirm.includes('DIC DCSSI Number'));

  const brandFirm = analyze('Brand Owner', 'Partnership', { brandOwnerProductionFacility: 'Yes' });
  assert.ok(!brandFirm.includes('CIN Number'));
  assert.ok(!brandFirm.includes('IEC Number'));
  assert.ok(!brandFirm.includes('DIC DCSSI Number'));
  assert.ok(brandFirm.includes('FACTORY LICENSE Number'));

  const importerCompany = analyze('Importer', 'Public Limited');
  assert.ok(!importerCompany.includes('FACTORY LICENSE Number'));
  assert.ok(!importerCompany.includes('DIC DCSSI Number'));
  assert.ok(importerCompany.includes('CIN Number'));
  assert.ok(importerCompany.includes('IEC Number'));

  const importerFirm = analyze('Importer', 'Proprietorship');
  assert.ok(!importerFirm.includes('CIN Number'));
  assert.ok(!importerFirm.includes('FACTORY LICENSE Number'));
  assert.ok(importerFirm.includes('DIC DCSSI Number'));
});

test('Brand Owner without production facility excludes the entire CTE and CTO/CCA section', () => {
  const analysis = analyzeClientMasterData({
    basic: { piboCategory: 'Brand Owner', companyType: 'Private Limited' },
    compliance: { msmeApplicable: 'No', brandOwnerProductionFacility: 'No' },
    cpcb: { linkedToCommonPortal: 'No', processDiagramRequired: 'No' }
  });
  assert.ok(!analysis.sections.some((section) => section.name === 'CTE & CTO / CCA'));
});

test('removed Company Overview fields do not affect completion', () => {
  const analysis = analyzeClientMasterData({ companyOverview: {} });
  assert.ok(!analysis.missingFields.includes('Product Manufacturer'));
  assert.ok(!analysis.missingFields.includes('Number of Employees'));
});
