const ProformaInvoice = require('../models/ProformaInvoice');
const Quotation = require('../models/Quotation');
const { resolveCrmRelationships } = require('../services/crmRelationships');
const { getVisibleUserScope } = require('../utils/visibilityScope');

const text = (value) => String(value || '').trim();
const money = (value) => Number.isFinite(Number(value)) ? Math.round(Number(value) * 100) / 100 : 0;
const mediaReference = (value) => {
  if (!value) return null;
  if (typeof value === 'string') return { name: text(value) };
  if (typeof value !== 'object') return null;
  return {
    name: text(value.name || value.fileName), type: text(value.type), size: Math.max(0, Number(value.size) || 0),
    url: text(value.secureUrl || value.url), secureUrl: text(value.secureUrl || value.url), publicId: text(value.publicId),
    resourceType: text(value.resourceType), format: text(value.format), bytes: Math.max(0, Number(value.bytes) || Number(value.size) || 0),
    width: Number(value.width) || null, height: Number(value.height) || null, duration: Number(value.duration) || null,
    uploadedAt: text(value.uploadedAt)
  };
};

async function nextProformaNumber() {
  const now = new Date();
  const start = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const fy = `${String(start).slice(-2)}-${String(start + 1).slice(-2)}`;
  const latest = await ProformaInvoice.findOne({ proformaNumber: new RegExp(`^PI/${fy}/\\d+$`, 'i') })
    .sort({ createdAt: -1 }).select('proformaNumber').lean();
  const sequence = (Number.parseInt(String(latest?.proformaNumber || '').split('/').pop(), 10) || 0) + 1;
  return `PI/${fy}/${String(sequence).padStart(3, '0')}`;
}

function cleanPayload(body = {}) {
  const leadDetails = body.leadDetails && typeof body.leadDetails === 'object' ? body.leadDetails : {};
  const items = (Array.isArray(body.items) ? body.items : []).map((item) => {
    const periodUnit = ['days', 'months', 'annual'].includes(String(item.periodUnit || '').trim())
      ? String(item.periodUnit).trim()
      : 'annual';
    const servicePeriodMax = periodUnit === 'days' ? 3650 : periodUnit === 'months' ? 600 : 100;
    const transitionPeriod = ['Yes', 'No'].includes(String(item.transitionPeriod || '').trim())
      ? String(item.transitionPeriod).trim()
      : 'No';
    return {
      serviceCategory: text(item.serviceCategory), servicesForYear: text(item.servicesForYear), financialYear: text(item.financialYear),
      validityPeriod: Math.max(1, Math.min(50, Number(item.validityPeriod) || 1)),
      servicePeriod: Math.max(1, Math.min(servicePeriodMax, Number(item.servicePeriod) || 1)),
      periodUnit,
      transitionPeriod,
      annualReturnYears: [...new Set((Array.isArray(item.annualReturnYears) ? item.annualReturnYears : []).map(text).filter(Boolean))],
      servicesOffered: text(item.servicesOffered), applicableService: text(item.applicableService),
      serviceStartDate: text(item.serviceStartDate), serviceEndDate: text(item.serviceEndDate),
      eprCategory: text(item.eprCategory), businessCategory: text(item.businessCategory) || undefined, piboParent: text(item.piboParent),
      piboCategory: text(item.piboCategory), unit: text(item.unit), basicAmount: money(item.basicAmount)
    };
  }).filter((item) => item.serviceCategory || item.piboCategory || item.basicAmount);
  const pricingMode = body.pricingMode === 'combined' ? 'combined' : 'individual';
  const individualTotal = items.reduce((sum, item) => sum + ((Number(item.unit) || 1) * item.basicAmount), 0);
  const combinedBasicAmount = pricingMode === 'combined' ? money(body.combinedBasicAmount) : 0;
  const calculated = pricingMode === 'combined' ? combinedBasicAmount : individualTotal;
  const gstRate = 18;
  const subtotal = money(calculated);
  const gstAmount = money(subtotal * gstRate / 100);
  const grandTotal = money(subtotal + gstAmount);
  const poYearCount = Math.max(0, Math.min(50, Number(body.poYearCount) || 0));
  const poYearRows = (Array.isArray(body.poYearRows) ? body.poYearRows : []).slice(0, poYearCount).map((row) => ({
    fy: text(row.fy), poNumber: text(row.poNumber), annualReturnYear: text(row.annualReturnYear), quotationNo: text(row.quotationNo),
    compliancePoDate: text(row.compliancePoDate), compliancePoFile: mediaReference(row.compliancePoFile),
    serviceCategory: [...new Set((Array.isArray(row.serviceCategory) ? row.serviceCategory : String(row.serviceCategory || '').split(',')).map(text).filter(Boolean))],
    value: money(row.value)
  }));
  return {
    invoiceDetails: Object.fromEntries(['deliveryNote','paymentTerms','reference','otherReferences','buyerOrder','buyerOrderDate','dispatchDocument','deliveryDate','dispatchedThrough','destination','deliveryTerms','consignee','consigneeAddress','consigneeGst','consigneeState','buyerStateCode','hsn','bankName','accountName','accountNumber','ifsc','pan','declaration'].filter((key) => Object.prototype.hasOwnProperty.call(body.invoiceDetails || {}, key)).map((key) => [key, text(body.invoiceDetails[key]).slice(0, 2000)])),
    quotationId: body.quotationId || undefined, quotationNumber: text(body.quotationNumber), poNumber: text(body.poNumber),
    leadId: text(body.leadId), leadCode: text(body.leadCode), companyName: text(body.companyName || leadDetails.companyName),
    leadDetails, invoiceDate: body.invoiceDate || new Date(), validUntil: text(body.validUntil), pricingMode, combinedBasicAmount, items, poYearCount, poYearRows,
    terms: (Array.isArray(body.terms) ? body.terms : String(body.terms || '').split(/\r?\n/)).map(text).filter(Boolean),
    scopeOfWork: (Array.isArray(body.scopeOfWork) ? body.scopeOfWork : String(body.scopeOfWork || '').split(/\r?\n/)).map(text).filter(Boolean),
    subtotal, gstRate, gstAmount, grandTotal,
    status: ['draft', 'issued', 'cancelled'].includes(body.status) ? body.status : 'issued'
  };
}

exports.list = async (req, res) => {
  const scope = await getVisibleUserScope(req.user);
  const rows = await ProformaInvoice.find(scope === null ? {} : { createdBy: { $in: scope.ids } }).populate('createdBy', 'name email').sort({ createdAt: -1 }).lean();
  return res.json({ ok: true, proformaInvoices: rows });
};

exports.create = async (req, res) => {
  const payload = cleanPayload(req.body);
  if (!payload.companyName) return res.status(400).json({ error: 'Company Name is required.' });
  if (!payload.poNumber) return res.status(400).json({ error: 'PO Number is required.' });
  if (!payload.quotationNumber) return res.status(400).json({ error: 'Quotation Number is required.' });
  if (!payload.items.length) return res.status(400).json({ error: 'At least one invoice item is required.' });
  if (payload.quotationId) {
    const quotation = await Quotation.findById(payload.quotationId).select('_id quotationNumber leadRef clientRef').lean();
    if (!quotation) return res.status(400).json({ error: 'Selected quotation was not found.' });
    payload.quotationNumber = quotation.quotationNumber;
    if (quotation.leadRef) payload.leadRef = quotation.leadRef;
    if (quotation.clientRef) payload.clientRef = quotation.clientRef;
  }
  Object.assign(payload, await resolveCrmRelationships(payload));
  const row = await ProformaInvoice.create({ ...payload, proformaNumber: await nextProformaNumber(), createdBy: req.user?._id });
  await row.populate('createdBy', 'name email');
  return res.status(201).json({ ok: true, proformaInvoice: row });
};

exports.update = async (req, res) => {
  const scope = await getVisibleUserScope(req.user);
  const row = await ProformaInvoice.findOne({ _id: req.params.id, ...(scope === null ? {} : { createdBy: { $in: scope.ids } }) });
  if (!row) return res.status(404).json({ error: 'Proforma Invoice not found or not accessible.' });
  const payload = cleanPayload(req.body);
  if (!payload.companyName || !payload.poNumber || !payload.quotationNumber || !payload.items.length) {
    return res.status(400).json({ error: 'Company, PO Number, Quotation Number and at least one item are required.' });
  }
  Object.assign(payload, await resolveCrmRelationships(payload));
  Object.assign(row, payload);
  await row.save();
  return res.json({ ok: true, proformaInvoice: row });
};

exports._test = { cleanPayload };
