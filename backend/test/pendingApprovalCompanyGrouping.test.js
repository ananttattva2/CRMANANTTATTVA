const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/PendingApproval.jsx'), 'utf8');
const start = source.indexOf('function getApprovalStatus');
const end = source.indexOf('function rowMatchesSearch', start);
const context = vm.createContext({});
vm.runInContext(source.slice(start, end), context);

test('pending clients show one company row with all distinct applicants retained for review', () => {
  const rows = [
    { id:'astra-importer', clientName:'ASTRA CHEMTECH PRIVATE LIMITED', approvalStatus:'PENDING', piboCategory:'Importer', eprCategory:'EPR - Plastic Waste', createdBy:'SHRUTI MAIN' },
    { id:'astra-brand-owner', clientName:'ASTRA CHEMTECH PRIVATE LIMITED', approvalStatus:'PENDING', piboCategory:'Brand Owner', eprCategory:'EPR - Plastic Waste', createdBy:'SHRUTI MAIN' },
    { id:'other-producer', clientName:'OTHER CLIENT LIMITED', approvalStatus:'PENDING', piboCategory:'Producer', eprCategory:'EPR - Plastic Waste', createdBy:'SONAL MORE' }
  ];
  const grouped = context.groupPendingClientsByCompany(rows);
  assert.equal(grouped.length, 2);
  const astra = grouped.find((row) => row.clientName === 'ASTRA CHEMTECH PRIVATE LIMITED');
  assert.equal(astra.id, 'astra-importer');
  assert.equal(astra.applicantCount, 2);
  assert.deepEqual(Array.from(astra._applicantTypes), ['Importer', 'Brand Owner']);
  assert.equal(astra.piboCategory, 'Importer, Brand Owner');
  assert.equal(astra._clientApprovalRows.length, 2);
});

test('mixed applicant decisions produce one partially-approved company row', () => {
  const [company] = context.groupPendingClientsByCompany([
    { id:'one', clientName:'Example Pvt Ltd', approvalStatus:'APPROVED', piboCategory:'Importer' },
    { id:'two', clientName:'Example Pvt Ltd', approvalStatus:'PENDING', piboCategory:'Brand Owner' }
  ]);
  assert.equal(company.approvalStatus, 'PARTIALLY_APPROVED');
});
