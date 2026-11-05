const test = require('node:test');
const assert = require('node:assert/strict');
const { latestQuotationAmountsByLead } = require('../src/services/latestLeadQuotation');

test('uses only the latest eligible quotation once for each open lead', () => {
  const lead = { _id: '64b000000000000000000001', leadCode: 'ATPL-0614' };
  const quotations = [
    { _id: '1', leadRef: lead._id, quotationNumber: 'AT/26-27/448', quotationDate: '2026-10-22', createdAt: '2026-10-22T10:00:00Z', grandTotal: 205000, status: 'approved', serviceState: 'open' },
    { _id: '2', leadCode: lead.leadCode, quotationNumber: 'AT/26-27/451', quotationDate: '2026-10-23', createdAt: '2026-10-23T09:00:00Z', grandTotal: 140000, status: 'admin_approved', serviceState: 'open' },
    { _id: '3', businessLeadCode: lead.leadCode, quotationNumber: 'AT/26-27/452', quotationDate: '2026-10-23', createdAt: '2026-10-23T12:00:00Z', grandTotal: 140000, status: 'admin_approved', serviceState: 'open' }
  ];

  const result = latestQuotationAmountsByLead([lead], quotations);
  assert.equal(result.get(String(lead._id)), 14000000);
});

test('ignores draft, rejected and closed quotation records', () => {
  const lead = { _id: '64b000000000000000000002', leadCode: 'ATPL-0999' };
  const quotations = [
    { leadId: lead._id, quotationNumber: 'Q-1', quotationDate: '2026-09-01', grandTotal: 50000, status: 'sent', serviceState: 'open' },
    { leadId: lead._id, quotationNumber: 'Q-2', quotationDate: '2026-10-01', grandTotal: 90000, status: 'draft', serviceState: 'open' },
    { leadId: lead._id, quotationNumber: 'Q-3', quotationDate: '2026-10-02', grandTotal: 100000, status: 'rejected', serviceState: 'open' },
    { leadId: lead._id, quotationNumber: 'Q-4', quotationDate: '2026-10-03', grandTotal: 120000, status: 'approved', serviceState: 'closed' }
  ];

  const result = latestQuotationAmountsByLead([lead], quotations);
  assert.equal(result.get(String(lead._id)), 5000000);
});
