const test = require('node:test');
const assert = require('node:assert/strict');
const { matchesTrackedService, buildUploadTracker, financialYearForDate } = require('../src/services/clientUploadTracker');
const user = { _id: 'sonal', name: 'Sonal', role: 'operation' };
function client(id, offered) {
  return { _id: id, assignedServiceId: id, selectedLead: { status: 'Closed', company: 'Example Ltd', assignments: [{ assignedServiceId: id, assignedStaff: user._id, assignedTo:'manager', poApprovalStatus:'APPROVED' }], serviceSelections: [{ assignedServiceId: id, servicesOffered: offered }] }, data: { basic: {} } };
}
test('annual and registration tabs match saved service aliases and arrays', () => {
  for (const name of ['Annual Return', 'Annual Filling', 'Annual Filing', 'Annual Return Filling']) {
    assert(matchesTrackedService(client('a', name), 'annual'));
    assert(!matchesTrackedService(client('a', name), 'registration'));
  }
  for (const name of ['Registration', 'New Registration']) {
    assert(matchesTrackedService(client('a', name), 'registration'));
    assert(!matchesTrackedService(client('a', name), 'annual'));
  }
  assert(matchesTrackedService(client('a', ['Consulting', 'New Registration']), 'registration'));
  assert(!matchesTrackedService(client('a', 'Consulting'), 'registration'));
});
test('service filtering precedes company aggregation so registration does not dilute annual progress', () => {
  const annual = client('annual', 'Annual Filling'), registration = client('registration', 'New Registration');
  const clients = [annual, registration];
  const purchase = [{ clientId: 'annual', checklist: [{ particular: 'Data Explained', yesNo: 'Yes' }] }];
  const ar = buildUploadTracker(clients.filter(row => matchesTrackedService(row, 'annual')), [user], purchase, []);
  const reg = buildUploadTracker(clients.filter(row => matchesTrackedService(row, 'registration')), [user], purchase, []);
  assert.equal(ar[0].clients.length, 1);
  assert.equal(ar[0].purchase[0].complete, 1);
  assert.deepEqual(ar[0].clients[0].clientIds, ['annual']);
  assert.equal(reg[0].purchase[0].pending, 1);
  assert.deepEqual(reg[0].clients[0].clientIds, ['registration']);
});
test('assigned service controls the filter when sibling services and stale basic data disagree', () => {
  const row = client('registration', 'New Registration');
  row.selectedLead.serviceSelections.unshift({ assignedServiceId: 'annual', servicesOffered: 'Annual Return Filling' });
  row.data.basic.servicesOffered = 'Annual Return Filling';
  assert(matchesTrackedService(row, 'registration'));
  assert(!matchesTrackedService(row, 'annual'));
});


test('AR allocation counts company categories separately and excludes registration-only categories', () => {
  const producer=client('producer','Annual Return'); producer.data.basic.piboCategory='Producer';
  const owner=client('owner','Annual Return Filling'); owner.data.basic.piboCategory='Brand Owner';
  const duplicate=client('duplicate','Annual Filling'); duplicate.data.basic.piboCategory='Producer';
  const registration=client('registration','New Registration'); registration.data.basic.piboCategory='Importer';
  const unrelated=client('consulting','Consulting'); unrelated.data.basic.piboCategory='Recycler';
  const purchases=[{clientId:'producer',checklist:[{particular:'Data Explained',yesNo:'Yes'}]}, {clientId:'duplicate',checklist:[{particular:'Data Explained',yesNo:'Yes'}]}];
  const ar=buildUploadTracker([producer,owner,duplicate,registration,unrelated],[user],purchases,[],{groupBy:'application',serviceType:'annual'});
  assert.equal(ar[0].clients.length,2);
  assert.deepEqual(ar[0].clients.map(row=>row.category),['Producer','Brand Owner']);
  assert.deepEqual(ar[0].clients[0].clientIds,['producer','duplicate']);
  assert.equal(ar[0].purchase[0].complete,1);
  assert.equal(ar[0].purchase[0].pending,1);
  assert.equal(ar[0].slaNotReceived,2);
  const reg=buildUploadTracker([producer,owner,duplicate,registration,unrelated],[user],purchases,[],{groupBy:'application',serviceType:'registration'});
  assert.equal(reg[0].clients.length,1);
  assert.deepEqual(reg[0].clients[0].clientIds,['registration']);
});

test('tracker follows Service Summary representative and prevents annual/registration double allocation', () => {
  const annual=client('annual','Annual Return Filling'), registration=client('registration','New Registration');
  annual.data.basic.piboCategory=registration.data.basic.piboCategory='Producer';
  const ar=buildUploadTracker([registration,annual],[user],[],[],{groupBy:'application',serviceType:'annual'});
  assert.equal(ar[0].clients.length,0);
  const reg=buildUploadTracker([registration,annual],[user],[],[],{groupBy:'application',serviceType:'registration'});
  assert.equal(reg[0].clients.length,1);
  assert.deepEqual(reg[0].clients[0].clientIds,['registration']);
});


test('Service Summary requires received current-FY PO for Annual Return while retaining recorded registration', async () => {
  const {buildApplicationPortfolio, applicationServiceSummaryRecords, matchesServiceSummary} = await import('../../frontend/src/utils/applicationPortfolio.mjs');
  const registration=client('registration','New Registration'), annual=client('annual','Annual Return Filling'), owner=client('owner','Annual Return'), open=client('open','Annual Return');
  registration.data.basic.piboCategory=annual.data.basic.piboCategory='Producer';
  owner.data.basic.piboCategory='Brand Owner';open.data.basic.piboCategory='Importer';open.selectedLead.status='Open';
  const rows=[registration,annual,owner,open];
  const summary=applicationServiceSummaryRecords(buildApplicationPortfolio(rows,[user])[0]);
  assert.equal(summary.filter(row=>matchesServiceSummary(row,'Annual Return Filling',new Date('2026-10-09T12:00:00+05:30'))).length,0);
  const registrationTracker=buildUploadTracker(rows,[user],[],[],{groupBy:'application',serviceType:'registration'});
  assert.equal(registrationTracker[0].clients.length,summary.filter(row=>matchesServiceSummary(row,'New Registration',new Date('2026-10-09T12:00:00+05:30'))).length);
});


test('AR allocation requires manager and permanent staff assignment; rejected PO retains allocated work', () => {
  for(const missing of ['assignedTo','assignedStaff',null]) {
    const row=client('workflow','Annual Filling');
    row.selectedLead.assignments[0].poApprovalStatus='REJECTED';
    if(missing) row.selectedLead.assignments[0][missing]='';
    const tracker=buildUploadTracker([row],[user],[],[],{groupBy:'application',serviceType:'annual'});
    assert.equal(tracker.reduce((sum,g)=>sum+g.clients.length,0),missing===null?1:0);
  }
});

test('AR allocation is restricted to the selected Annual Return year', () => {
  const ar2025 = client('ar-2025', 'Annual Return Filling');
  ar2025.selectedLead.company = 'AR 2025 Client';
  ar2025.data.cpcb = { status: 'Approved' };
  ar2025.selectedLead.assignments[0].poStatus = 'received';
  ar2025.selectedLead.assignments[0].poYearRows = [{ poFinancialYear: financialYearForDate(), annualReturnYear: '2025-26', poNumber: 'PO-1' }];
  const ar2026 = client('ar-2026', 'Annual Return Filling');
  ar2026.selectedLead.company = 'AR 2026 Client';
  ar2026.data.cpcb = { status: 'Approved' };
  ar2026.selectedLead.assignments[0].poStatus = 'received';
  ar2026.selectedLead.assignments[0].poYearRows = [{ poFinancialYear: financialYearForDate(), annualReturnYear: '2026-27', poNumber: 'PO-2' }];
  const poYear = client('po-year', 'Annual Return Filling');
  poYear.selectedLead.company = 'PO Annual Year Client';
  poYear.data.cpcb = { status: 'Approved' };
  poYear.selectedLead.assignments[0].poStatus = 'received';
  poYear.selectedLead.assignments[0].poYearRows = [{ poFinancialYear: financialYearForDate(), annualReturnYear: '2025-26', poNumber: 'PO-3' }];
  const actionRequired = client('action-required', 'Annual Return Filling');
  actionRequired.selectedLead.company = 'Action Required Client';
  actionRequired.data.cpcb = { status: 'Not Started' };
  actionRequired.selectedLead.assignments[0].poStatus = 'received';
  actionRequired.selectedLead.assignments[0].poYearRows = [{ poFinancialYear: financialYearForDate(), annualReturnYear: '2025-26', poNumber: 'PO-4' }];
  const tracker = buildUploadTracker([ar2025, ar2026, poYear, actionRequired], [user], [], [], { groupBy: 'application', serviceType: 'annual', financialYear: '2025-26' });
  assert.deepEqual(tracker[0].clients.map(row => row.clientName).sort(), ['AR 2025 Client', 'PO Annual Year Client']);
});
