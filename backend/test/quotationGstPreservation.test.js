const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('quotation list refresh keeps approved GST even when linked lead has no GST', async () => {
  const { mergeQuotationLeadDetails } = await import('../../frontend/src/utils/quotationLeadDetails.mjs');
  const source = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/Quotations.jsx'), 'utf8');
  const code = source.slice(source.indexOf('function syncQuotationWithLead('), source.indexOf('function findLeadForQuotation('));
  const context = { mergeQuotationLeadDetails, mapLeadToDetails: lead => ({ companyName: lead.company, city: lead.city, gstNumber: lead.gstNumber || '' }), syncQuotationItemsWithLead: items => items };
  vm.createContext(context);
  vm.runInContext(code, context);
  const quotation = { quotationNumber: 'AT/26-27/475', status: 'admin_approved', leadDetails: { gstNumber: '24AAACM4100C1ZF', city: 'Old city' }, items: [] };
  const result = context.syncQuotationWithLead(quotation, { company: 'Client', city: 'Valsad' });
  assert.equal(result.leadDetails.gstNumber, '24AAACM4100C1ZF');
  assert.equal(result.leadDetails.city, 'Valsad');
  assert.equal(result.status, 'admin_approved');
  assert.equal(quotation.leadDetails.city, 'Old city');
});

test('revising a saved quotation keeps its GST while refreshing lead-owned fields', async () => {
  const { mergeQuotationLeadDetails } = await import('../../frontend/src/utils/quotationLeadDetails.mjs');
  const saved = { gstNumber: '24AAACM4100C1ZF' };
  assert.equal(mergeQuotationLeadDetails(saved, { gstNumber: '27AAZCA6657R1ZB' }).gstNumber, saved.gstNumber);
  assert.equal(mergeQuotationLeadDetails({}, { gstNumber: '27AAZCA6657R1ZB' }).gstNumber, '27AAZCA6657R1ZB');
  assert.equal(mergeQuotationLeadDetails({ gstNumber: '' }, { gstNumber: '27AAZCA6657R1ZB' }).gstNumber, '');
  assert.equal(mergeQuotationLeadDetails().gstNumber, '');
});
