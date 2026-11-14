const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  normalizeFinancialYear,
  normalizeServiceName,
  resolveAnnualReturnPO
} = require('../src/services/annualReturnPoResolver');

const leadId = '6a7426143e6eb1b90295ed87';
const otherLeadId = '6a7426143e6eb1b90295ed88';
const client = { _id: '6a842adf38a334ba9d8c4ff7', selectedLead: otherLeadId, data: { selectedLead: leadId, basic: { firstAnnualReturnYear: '2023-24' } } };

function lead(overrides = {}) {
  return {
    _id: leadId,
    leadCode: 'ATPL-LEAD-0004',
    firstAnnualReturnYearApplicable: '2025-26',
    serviceSelections: [
      { assignedServiceId: 'registration', servicesOffered: 'New Registration', firstAnnualReturnYearApplicable: '2023-24' },
      { assignedServiceId: 'annual', servicesOffered: 'Annual Return Filling', firstAnnualReturnYearApplicable: '2025-26' }
    ],
    assignments: [
      { assignedServiceId: 'registration', poStatus: 'received', poYearRows: [] },
      { assignedServiceId: 'annual', poStatus: 'received', poYearRows: [] }
    ],
    ...overrides
  };
}

function modelFor(document, onFind = () => {}) {
  return {
    findById(id) {
      onFind(id);
      return { select() { return this; }, async lean() { return document; } };
    },
    findOne() {
      return { select() { return this; }, async lean() { return document; } };
    }
  };
}

function annualPo(overrides = {}) {
  return {
    fy: '2025-26',
    poNumber: 'CCL/PO/HO/WOOTH/67/2026-2027',
    poFileUrl: 'https://res.cloudinary.com/example/annual-return.pdf',
    poFileName: 'Anantattva Private Limited Work order.pdf',
    services: ['Annual Return Filling'],
    ...overrides
  };
}

test('normalizes financial-year and Annual Return service naming differences', () => {
  for (const value of ['2025-26', '2025 - 26', '2025–26', 'FY 2025-26', '2025/26']) {
    assert.equal(normalizeFinancialYear(value), '2025-26');
  }
  assert.equal(normalizeServiceName('Annual Return Filling'), 'annualreturn');
  assert.equal(normalizeServiceName('Annual Return'), 'annualreturn');
});

test('resolves the matching Annual Return PO through Client Master data.selectedLead', async () => {
  const source = lead();
  source.assignments[1].poYearRows = [annualPo()];
  let queriedId = '';
  const result = await resolveAnnualReturnPO({ clientMaster: client, financialYears: ['2025-26'], LeadModel: modelFor(source, (id) => { queriedId = id; }) });
  assert.equal(queriedId, leadId);
  assert.equal(result.years[0].poStatus, 'received');
  assert.equal(result.years[0].po.number, 'CCL/PO/HO/WOOTH/67/2026-2027');
  assert.equal(result.years[0].po.source, 'lead');
});

test('uses Annual Return Year instead of the later PO Financial Year for the hub', async () => {
  const source = lead();
  source.assignments[1].poYearRows = [annualPo({ fy: '2026-27', poFinancialYear: '2026-27', annualReturnYear: '2025-26' })];
  const result = await resolveAnnualReturnPO({ clientMaster: client, financialYears: ['2025-26', '2026-27'], LeadModel: modelFor(source) });
  assert.equal(result.years[0].poStatus, 'received');
  assert.equal(result.years[1].poStatus, 'pending');
});

test('does not consume a same-year PO belonging only to an unrelated service', async () => {
  const source = lead();
  source.assignments[0].poYearRows = [annualPo({ poNumber: 'REG-PO', services: ['New Registration'] })];
  const result = await resolveAnnualReturnPO({ clientMaster: client, financialYears: ['2025-26'], LeadModel: modelFor(source) });
  assert.equal(result.years[0].poStatus, 'pending');
  assert.equal(result.years[0].po, null);
});

test('returns pending only from the explicit Annual Return requirement year onward', async () => {
  const result = await resolveAnnualReturnPO({ clientMaster: client, financialYears: ['2024-25', '2025-26'], LeadModel: modelFor(lead()) });
  assert.deepEqual(result.years.map((row) => [row.fy, row.poStatus, row.poRequired]), [
    ['2024-25', 'not_required', false],
    ['2025-26', 'pending', true]
  ]);
});

test('returns controlled unlinked states for missing and deleted source Leads', async () => {
  const withoutLink = await resolveAnnualReturnPO({ clientMaster: { data: {} }, financialYears: ['2025-26'], LeadModel: modelFor(null) });
  const deleted = await resolveAnnualReturnPO({ clientMaster: client, financialYears: ['2025-26'], LeadModel: modelFor(null) });
  assert.equal(withoutLink.years[0].poStatus, 'unlinked');
  assert.equal(deleted.years[0].poStatus, 'unlinked');
});

test('deduplicates identical Annual Return POs but reports different records as a conflict', async () => {
  const duplicateLead = lead();
  duplicateLead.assignments[0].poYearRows = [annualPo()];
  duplicateLead.assignments[1].poYearRows = [annualPo()];
  const duplicate = await resolveAnnualReturnPO({ clientMaster: client, financialYears: ['2025-26'], LeadModel: modelFor(duplicateLead) });
  assert.equal(duplicate.years[0].poStatus, 'received');

  duplicateLead.assignments[1].poYearRows.push(annualPo({ poNumber: 'ANOTHER-PO', poFileUrl: 'https://example.com/another.pdf' }));
  const conflict = await resolveAnnualReturnPO({ clientMaster: client, financialYears: ['2025-26'], LeadModel: modelFor(duplicateLead) });
  assert.equal(conflict.years[0].poStatus, 'conflict');
  assert.equal(conflict.years[0].po, null);
});

test('scopes same-year Annual Return POs to the selected Producer or Importer Client Master', async () => {
  const source = lead({
    serviceSelections: [
      { assignedServiceId: 'annual-importer', subApplicantType: 'Importer', servicesOffered: 'Annual Return Filling', firstAnnualReturnYearApplicable: '2025-26' },
      { assignedServiceId: 'annual-producer', subApplicantType: 'Producer', servicesOffered: 'Annual Return Filling', firstAnnualReturnYearApplicable: '2025-26' }
    ],
    assignments: [
      { assignedServiceId: 'annual-importer', poStatus: 'received', poYearRows: [annualPo({ poNumber: 'IMPORTER-15000', poAmount: 15000 })] },
      { assignedServiceId: 'annual-producer', poStatus: 'received', poYearRows: [annualPo({ poNumber: 'PRODUCER-25000', poAmount: 25000 })] }
    ]
  });
  const producerClient = { ...client, assignedServiceId: 'annual-producer', data: { ...client.data, assignedServiceId: 'annual-producer', basic: { ...client.data.basic, piboCategory: 'Producer' } } };
  const importerClient = { ...client, assignedServiceId: 'annual-importer', data: { ...client.data, assignedServiceId: 'annual-importer', basic: { ...client.data.basic, piboCategory: 'Importer' } } };

  const [producer, importer] = await Promise.all([
    resolveAnnualReturnPO({ clientMaster: producerClient, financialYears: ['2025-26'], LeadModel: modelFor(source) }),
    resolveAnnualReturnPO({ clientMaster: importerClient, financialYears: ['2025-26'], LeadModel: modelFor(source) })
  ]);
  assert.equal(producer.years[0].poStatus, 'received');
  assert.equal(producer.years[0].po.number, 'PRODUCER-25000');
  assert.equal(importer.years[0].poStatus, 'received');
  assert.equal(importer.years[0].po.number, 'IMPORTER-15000');
});

test('uses applicant type to scope legacy Client Masters without a matching assignment id', async () => {
  const source = lead({
    serviceSelections: [
      { assignedServiceId: 'legacy-importer', piboCategory: 'Importer', servicesOffered: 'Annual Return Filling' },
      { assignedServiceId: 'legacy-producer', piboCategory: 'Producer', servicesOffered: 'Annual Return Filling' }
    ],
    assignments: [
      { assignedServiceId: 'legacy-importer', poStatus: 'received', poYearRows: [annualPo({ poNumber: 'IMPORTER-PO' })] },
      { assignedServiceId: 'legacy-producer', poStatus: 'received', poYearRows: [annualPo({ poNumber: 'PRODUCER-PO' })] }
    ]
  });
  const legacyProducer = { ...client, data: { ...client.data, basic: { ...client.data.basic, piboCategory: 'Producer' } } };
  const result = await resolveAnnualReturnPO({ clientMaster: legacyProducer, financialYears: ['2025-26'], LeadModel: modelFor(source) });
  assert.equal(result.years[0].poStatus, 'received');
  assert.equal(result.years[0].po.number, 'PRODUCER-PO');
});

test('falls back to applicant type when a stale service id points to a sibling applicant', async () => {
  const source = lead({
    serviceSelections: [
      { assignedServiceId: 'annual-brand-owner', piboCategory: 'Brand Owner', servicesOffered: 'Annual Return Filling' },
      { assignedServiceId: 'annual-importer', piboCategory: 'Importer', servicesOffered: 'Annual Return Filling' }
    ],
    assignments: [
      { assignedServiceId: 'annual-brand-owner', poStatus: 'received', poYearRows: [annualPo({ poNumber: 'BRAND-OWNER-PO' })] },
      { assignedServiceId: 'annual-importer', poStatus: 'received', poYearRows: [annualPo({ poNumber: 'IMPORTER-PO' })] }
    ]
  });
  const staleImporter = { ...client, assignedServiceId: 'annual-brand-owner', data: { ...client.data, assignedServiceId: 'annual-brand-owner', basic: { ...client.data.basic, piboCategory: 'Importer' } } };
  const result = await resolveAnnualReturnPO({ clientMaster: staleImporter, financialYears: ['2025-26'], LeadModel: modelFor(source) });
  assert.equal(result.years[0].poStatus, 'received');
  assert.equal(result.years[0].po.number, 'IMPORTER-PO');
});

test('PO resolution does not mutate existing Lead, Client Master, or Annual Return data', async () => {
  const source = lead();
  source.assignments[1].poYearRows = [annualPo()];
  const existing = { ...client, data: { ...client.data, annualReturn: { filings: { '2025-26': { draft: { existing: true } } } } } };
  const beforeClient = JSON.stringify(existing);
  const beforeLead = JSON.stringify(source);
  await resolveAnnualReturnPO({ clientMaster: existing, financialYears: ['2025-26'], LeadModel: modelFor(source) });
  assert.equal(JSON.stringify(existing), beforeClient);
  assert.equal(JSON.stringify(source), beforeLead);
});

test('preserves an existing saved Annual Return PO only as a legacy fallback', async () => {
  const existing = {
    ...client,
    data: {
      ...client.data,
      annualReturn: { filings: { '2025-26': { draft: { purchaseOrderConfirmation: {
        confirmed: true,
        rows: [{ fyYear: 'FY 2025-26', poNumber: 'LEGACY-PO', service: 'Annual Return', file: { url: 'https://example.com/legacy.pdf', name: 'legacy.pdf' } }]
      } } } } }
    }
  };
  const fallback = await resolveAnnualReturnPO({ clientMaster: existing, financialYears: ['2025-26'], LeadModel: modelFor(lead()) });
  assert.equal(fallback.years[0].poStatus, 'received');
  assert.equal(fallback.years[0].po.source, 'annual_return_legacy');

  const source = lead();
  source.assignments[1].poYearRows = [annualPo()];
  const preferred = await resolveAnnualReturnPO({ clientMaster: existing, financialYears: ['2025-26'], LeadModel: modelFor(source) });
  assert.equal(preferred.years[0].po.number, 'CCL/PO/HO/WOOTH/67/2026-2027');
  assert.equal(preferred.years[0].po.source, 'lead');
});

test('PO status API remains authenticated and UI uses loading state instead of temporary pending', () => {
  const routes = fs.readFileSync(path.resolve(__dirname, '../src/routes/clients.js'), 'utf8');
  const ui = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/features/clientMaster/ClientMasterAnnualReturn.jsx'), 'utf8');
  assert.match(routes, /annual-return\/po-status', requireAuth, clientCtrl\.getAnnualReturnPoStatus/);
  assert.match(ui, /Checking PO details\.\.\./);
  assert.match(ui, /annualReturnPoStatus/);
  assert.doesNotMatch(ui, /Frozen — PO details pending/);
  assert.match(ui, /target="_blank" rel="noopener noreferrer"/);
});
