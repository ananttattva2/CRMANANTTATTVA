const Client = require('../models/Client');
const { userHasAnyRole } = require('../utils/userRoles');
const { parseHistoricalProformas, historicalSequence } = require('../services/historicalProformaImport');
const { validGst, invoicePartyDetails } = require('../services/invoicePartyDetails');
const ProformaInvoice = require('../models/ProformaInvoice');
const { resolvePoProof } = require('../services/poProofResolver');
const Lead = require('../models/Lead');
const { eligibleItems, assignmentForService, poRowsForQuotation } = require('../services/proformaEligibility');
const Quotation = require('../models/Quotation');
const { resolveCrmRelationships } = require('../services/crmRelationships');
const { getVisibleUserScope } = require('../utils/visibilityScope');

const text = (value) => String(value || '').trim();
const creditServiceYears = item => { const basis = item.financialYear || item.servicesForYear; return (item.annualReturnEprCreditYears?.length ? item.annualReturnEprCreditYears : [basis]).filter(Boolean).map(value => { const match = String(value).match(/^(\d{4})-(\d{2})$/); return value === basis && match ? String(Number(match[1]) - 1) + '-' + match[1].slice(-2) : value; }).join(', '); };
const isCredit = item => String(item.businessCategory || '').toLowerCase().replace(/[^a-z0-9]/g, '') === 'eprcredit';
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
  const [latest] = await ProformaInvoice.aggregate([
    { $match: { proformaNumber: new RegExp(`^(?:ATPI|PI)/${fy}/\\d+$`, 'i') } },
    {
      $project: {
        sequence: {
          $convert: {
            input: { $arrayElemAt: [{ $split: ['$proformaNumber', '/'] }, 2] },
            to: 'int',
            onError: 0,
            onNull: 0
          }
        }
      }
    },
    { $sort: { sequence: -1 } },
    { $limit: 1 }
  ]);
  const sequence = Math.max(203, (Number(latest?.sequence) || 0) + 1);
  return `ATPI/${fy}/${String(sequence).padStart(3, '0')}`;
}
function authoritativePoRows(rows = [], quotationNumber = '') {
  const quotationKey = text(quotationNumber).toUpperCase();
  return rows.filter(row => text(row?.poNumber || row?.poNo)
    && (!quotationKey || text(row?.poNumber || row?.poNo).toUpperCase() !== quotationKey)).map(row => ({
    ...row,
    poNumber: text(row.poNumber || row.poNo)
  }));
}
function applyLeadPoRows(payload, rows, quotationNumber) {
  const poYearRows = authoritativePoRows(rows, quotationNumber);
  if (!poYearRows.length) return false;
  const invoicePoNumber = text(payload.poNumber);
  const quotationKey = text(quotationNumber).toUpperCase();
  if (invoicePoNumber && quotationKey && invoicePoNumber.toUpperCase() === quotationKey) return false;
  payload.poYearRows = poYearRows;
  payload.poYearCount = poYearRows.length;
  payload.poNumber = invoicePoNumber || poYearRows[0].poNumber;
  return true;
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
      sourceItemIndex: Number.isInteger(item.sourceItemIndex) ? item.sourceItemIndex : undefined, assignedServiceId: text(item.assignedServiceId), serviceCategory: text(item.serviceCategory), servicesForYear: text(item.servicesForYear), financialYear: text(item.financialYear),
      validityPeriod: Math.max(1, Math.min(50, Number(item.validityPeriod) || 1)),
      servicePeriod: Math.max(1, Math.min(servicePeriodMax, Number(item.servicePeriod) || 1)),
      periodUnit,
      transitionPeriod,
      eprCreditRatePerKg: item.eprCreditRatePerKg == null ? undefined : money(item.eprCreditRatePerKg),
      annualReturnEprCreditYears: [...new Set((Array.isArray(item.annualReturnEprCreditYears) ? item.annualReturnEprCreditYears : []).map(text).filter(Boolean))],
      annualReturnYears: [...new Set((Array.isArray(item.annualReturnYears) ? item.annualReturnYears : []).map(text).filter(Boolean))],
      servicesOffered: text(item.servicesOffered), applicableService: text(item.applicableService),
      serviceStartDate: text(item.serviceStartDate), serviceEndDate: text(item.serviceEndDate),
      eprCategory: text(item.eprCategory), businessCategory: text(item.businessCategory) || undefined, piboParent: text(item.piboParent),
      piboCategory: text(item.piboCategory), unit: text(item.unit), basicAmount: money(item.basicAmount)
    };
  }).filter((item) => item.serviceCategory || item.piboCategory || item.basicAmount);
  const pricingMode = body.pricingMode === 'combined' ? 'combined' : 'individual';
  const individualTotal = items.reduce((sum, item) => sum + ((isCredit(item) ? 1 : (Number(item.unit) || 1)) * item.basicAmount), 0);
  const combinedBasicAmount = pricingMode === 'combined' ? money(body.combinedBasicAmount) : 0;
  const calculated = pricingMode === 'combined' ? combinedBasicAmount : individualTotal;
  const gstRate = 18;
  const paymentPercentage = body.paymentPercentage == null ? 100 : Number(body.paymentPercentage);
  const paymentStage = body.paymentStage === 'later' ? 'later' : 'advance';
  const subtotal = money(calculated * (Number.isFinite(paymentPercentage) ? paymentPercentage : 0) / 100);
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
    quotationId: body.quotationId || undefined, quotationNumber: text(body.quotationNumber), poNumber: text(body.poNumber).slice(0, 120),
    leadId: text(body.leadId), leadCode: text(body.leadCode), companyName: text(body.companyName || leadDetails.companyName),
    leadDetails, invoiceDate: body.invoiceDate || new Date(), validUntil: text(body.validUntil), pricingMode, combinedBasicAmount, items, poYearCount, poYearRows,
    terms: (Array.isArray(body.terms) ? body.terms : String(body.terms || '').split(/\r?\n/)).map(text).filter(Boolean),
    scopeOfWork: (Array.isArray(body.scopeOfWork) ? body.scopeOfWork : String(body.scopeOfWork || '').split(/\r?\n/)).map(text).filter(Boolean),
    fullSubtotal: money(calculated), paymentPercentage, paymentStage, subtotal, gstRate, gstAmount, grandTotal,
    status: ['draft', 'issued', 'cancelled'].includes(body.status) ? body.status : 'issued'
  };
}

exports.list = async (req, res) => {
  const scope = await getVisibleUserScope(req.user);
  const rows = await ProformaInvoice.find(scope === null ? {} : { createdBy: { $in: scope.ids } }).populate('createdBy', 'name email').sort({ createdAt: -1 }).lean();
  const creditRows = rows.filter(row => (row.items || []).some(item => isCredit(item) && (!item.annualReturnEprCreditYears?.length || item.eprCreditRatePerKg == null || !item.financialYear)));
  const quoteIds = [...new Set(creditRows.map(row => String(row.quotationId || '')).filter(id => /^[a-f0-9]{24}$/i.test(id)))];
  if (quoteIds.length) {
    const quotes = await Quotation.find({ _id: { $in: quoteIds } }).select('items').lean();
    const byId = new Map(quotes.map(quote => [String(quote._id), quote]));
    for (const row of creditRows) for (const item of row.items || []) {
      if (!isCredit(item)) continue;
      const sourceItems = byId.get(String(row.quotationId))?.items || [];
      const matches = sourceItems.filter(source => isCredit(source) && source.serviceCategory === item.serviceCategory && source.servicesOffered === item.servicesOffered && source.piboCategory === item.piboCategory);
      const source = item.sourceItemIndex != null ? sourceItems[item.sourceItemIndex] : matches.length === 1 ? matches[0] : null;
      if (!source || !isCredit(source)) continue;
      if (!item.annualReturnEprCreditYears?.length) item.annualReturnEprCreditYears = source.annualReturnEprCreditYears || [];
      if (item.eprCreditRatePerKg == null) item.eprCreditRatePerKg = money(source.basicAmount);
      if (!item.financialYear) item.financialYear = source.financialYear || source.servicesForYear;
    }
  }
  const missingGst = rows.filter(row => !row.historicalImport && !validGst(row.leadDetails?.gstNumber));
  if (missingGst.length) {
    const ids = values => [...new Set(values.map(value => String(value || '')).filter(value => /^[a-f0-9]{24}$/i.test(value)))];
    const clients = await Client.find({ $or: [{ _id: { $in: ids(missingGst.map(row => row.clientRef)) } }, { selectedLead: { $in: ids(missingGst.map(row => row.leadRef)) } }, { 'data.basic.clientLegalName': { $in: missingGst.map(row => row.companyName).filter(Boolean) } }] }).select('data.basic data.compliance data.selectedLeadSnapshot selectedLead').lean();
    for (const row of missingGst) {
      const client = clients.find(client => String(client._id) === String(row.clientRef) || (row.leadRef && String(client.selectedLead) === String(row.leadRef)) || client.data?.basic?.clientLegalName === row.companyName);
      row.leadDetails = invoicePartyDetails(row.leadDetails, client || {});
    }
  }
  return res.json({ ok: true, proformaInvoices: rows });
};

async function visibleEmailInvoice(req) {
  const scope = await getVisibleUserScope(req.user);
  const invoice = await ProformaInvoice.findOne({ _id: req.params.id, ...(scope === null ? {} : { createdBy: { $in: scope.ids } }) }).populate('createdBy', 'name email').lean();
  if (!invoice) throw Object.assign(new Error('Invoice not found or not accessible.'), { status: 404 });
  if (invoice.status === 'cancelled') throw Object.assign(new Error('Cancelled invoices cannot be emailed.'), { status: 400 });
  if (!validGst(invoice.leadDetails?.gstNumber)) {
    const clauses = [{ 'data.basic.clientLegalName': invoice.companyName }];
    if (invoice.clientRef) clauses.unshift({ _id: invoice.clientRef });
    if (invoice.leadRef) clauses.unshift({ selectedLead: invoice.leadRef });
    const client = await Client.findOne({ $or: clauses }).select('data.basic data.compliance data.selectedLeadSnapshot').lean();
    invoice.leadDetails = invoicePartyDetails(invoice.leadDetails, client || {});
    if (!validGst(invoice.leadDetails.gstNumber)) throw Object.assign(new Error('Client GSTIN/UIN is missing. Edit and save the GSTIN before sending this PI.'), { status: 400 });
  }
  return invoice;
}
exports.emailOptions = async (req, res, next) => {
  try {
    const invoice = await visibleEmailInvoice(req);
    const mandatoryCc = await require('../services/proformaEmail').requiredCopies(invoice, req.user);
    return res.json({ ok: true, mandatoryCc, to: invoice.leadDetails?.email || '', subject: `Proforma Invoice ${invoice.proformaNumber} | ${invoice.companyName}`, body: `Dear ${invoice.leadDetails?.contactPerson || 'Sir/Madam'},\n\nPlease find attached Proforma Invoice ${invoice.proformaNumber} for ${invoice.companyName}.\n\nKindly review the invoice and arrange payment as per the agreed terms. Please contact us if you need any clarification.\n\nThank you,\n${req.user.name || 'Team Ananttattva'}` });
  } catch (error) { next(error); }
};
exports.sendEmail = async (req, res, next) => {
  try {
    const delivery = require('../services/proformaEmail');
    const { to, cc: enteredCc, subject, message } = delivery.validateMessage(req.body);
    const invoice = await visibleEmailInvoice(req);
    const cc = [...new Set([...enteredCc, ...await delivery.requiredCopies(invoice, req.user)])].filter(email => !to.includes(email));
    const pdf = await delivery.invoicePdf(invoice);
    const content = await require('../services/quotationDelivery').clientEmailContent(subject, message);
    const result = await require('../utils/mailer').sendMail(to, subject, content.html, {
      branded: false, cc, attachments: [{ filename: `${invoice.proformaNumber.replace(/[^a-z0-9-]/gi, '-')}.pdf`, content: pdf, contentType: 'application/pdf' }, content.logo].filter(Boolean)
    });
    if (result?.summary?.rejected?.length) throw Object.assign(new Error('The email provider rejected one or more recipients. Please verify their addresses before retrying.'), { status: 502 });
    await ProformaInvoice.updateOne({ _id: invoice._id }, { $push: { emailHistory: { to, cc, subject, sentBy: req.user._id, sentAt: new Date() } } });
    return res.json({ ok: true, message: 'Invoice email accepted for delivery with PDF attachment.', to, cc });
  } catch (error) { next(error); }
};

exports.importHistorical = async (req, res, next) => {
  if (!userHasAnyRole(req.user, ['admin', 'superadmin', 'finance', 'accounts'])) {
    return res.status(403).json({ error: 'Historical PI import requires Finance, Accounts, or Admin access.' });
  }
  try {
    const invoices = parseHistoricalProformas(req.body?.rows, cleanPayload);
    const existing = await ProformaInvoice.find({ proformaNumber: /^(?:ATPI|PI)\/26-27\/\d+$/i })
      .select('proformaNumber').lean();
    const occupied = new Set(existing.map(row => historicalSequence(row.proformaNumber)));
    const pending = invoices.filter(invoice => !occupied.has(historicalSequence(invoice.proformaNumber)));
    const now = new Date();
    const writes = pending.map(invoice => ({
      updateOne: {
        filter: { proformaNumber: invoice.proformaNumber },
        update: { $setOnInsert: { ...invoice, createdBy: req.user._id, createdAt: now, updatedAt: now } },
        upsert: true,
        timestamps: false
      }
    }));
    const created = writes.length ? (await ProformaInvoice.bulkWrite(writes, { ordered: false })).upsertedCount : 0;
    return res.status(201).json({ ok: true, created, skipped: invoices.length - created });
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ error: error.message });
    if (error.code === 11000) return res.status(409).json({ error: 'Another import saved a matching PI number. Upload the same workbook again to save any remaining invoices.' });
    return next(error);
  }
};

exports.create = async (req, res) => {
  const payload = cleanPayload(req.body);
  if (!payload.companyName) return res.status(400).json({ error: 'Company Name is required.' });
  if (!payload.quotationNumber) return res.status(400).json({ error: 'Quotation Number is required.' });
  if (!payload.items.length) return res.status(400).json({ error: 'At least one invoice item is required.' });
  const validationError = await validateInvoice(payload, null, req.user);
  if (validationError) return res.status(400).json({ error: validationError });
  if (!validGst(payload.leadDetails.gstNumber)) return res.status(400).json({ error: 'Client GSTIN/UIN is required. Enter the valid 15-character GSTIN before saving the PI.' });
  const row = await ProformaInvoice.create({ ...payload, proformaNumber: await nextProformaNumber(), createdBy: req.user?._id });
  await row.populate('createdBy', 'name email');
  return res.status(201).json({ ok: true, proformaInvoice: row });
};

exports.update = async (req, res) => {
  const scope = await getVisibleUserScope(req.user);
  const row = await ProformaInvoice.findOne({ _id: req.params.id, ...(scope === null ? {} : { createdBy: { $in: scope.ids } }) });
  if (!row) return res.status(404).json({ error: 'Proforma Invoice not found or not accessible.' });
  if (row.historicalImport) return res.status(409).json({ error: 'Imported historical invoices are read-only.' });
  const payload = cleanPayload(req.body);
  if (!payload.companyName || !payload.quotationNumber || !payload.items.length) {
    return res.status(400).json({ error: 'Company, Quotation Number and at least one item are required.' });
  }
  const validationError = await validateInvoice(payload, row._id, req.user);
  if (validationError) return res.status(400).json({ error: validationError });
  Object.assign(row, payload);
  await row.save();
  return res.json({ ok: true, proformaInvoice: row });
};

exports._test = { cleanPayload, validateInvoice, nextProformaNumber, authoritativePoRows, applyLeadPoRows, poRowsForQuotation };

async function quotationContext(id) {
  const quote = await Quotation.findById(id).lean();
  if (!quote) return {};
  let refs = quote.leadRef ? { leadRef: quote.leadRef } : await resolveCrmRelationships({ leadId: quote.leadId || quote.leadCode });
  if (!refs.leadRef) refs = await resolveCrmRelationships({ companyName: quote.leadDetails?.companyName || quote.companyName });
  const lead = refs.leadRef ? await Lead.findById(refs.leadRef).lean() : null;
  const matched = lead ? eligibleItems(quote, lead) : [];
  const items = (quote.items || []).map((item, sourceItemIndex) => {
    const mapped = matched.find(row => row.sourceItemIndex === sourceItemIndex) || { ...item, sourceItemIndex };
    if (!isCredit(item)) return mapped;
    const target = item.eprCreditTargetMt ?? (item.eprCreditTargetKg != null ? Number(item.eprCreditTargetKg) / 1000 : null);
    return { ...mapped, financialYear: item.financialYear || item.servicesForYear, servicesForYear: creditServiceYears(item), eprCreditRatePerKg: money(item.basicAmount), unit: target == null ? '' : String(target), basicAmount: target == null ? 0 : money(Number(item.basicAmount) * 1000 * Number(target)) };
  });
  const orders = new Map();
  for (const item of items) {
    const assignment = assignmentForService(lead || {}, item.assignedServiceId, item.sourceServiceIndex, lead?.serviceSelections?.length || 1);
    const rows = assignment?.poYearRows?.length ? assignment.poYearRows : assignment?.originalPoDetails ? [assignment.originalPoDetails] : [assignment];
    for (const po of poRowsForQuotation(rows.filter(Boolean), quote)) {
      const proof = resolvePoProof({ ...po, poFile: po.poFile || po.compliancePoFile });
      const poNumber = text(po.poNumber || po.poNo);
      if (!poNumber || poNumber.toUpperCase() === text(quote.quotationNumber).toUpperCase() || !proof.url) continue;
      const key = `${poNumber}|${po.fy || po.poFinancialYear || ''}`;
      const row = orders.get(key) || { fy: po.fy || po.poFinancialYear || '', poNumber, compliancePoFile: { name: proof.name || 'PO proof', secureUrl: proof.url, url: proof.url }, serviceCategory: [] };
      row.serviceCategory = [...new Set([...row.serviceCategory, item.serviceCategory])];
      orders.set(key, row);
    }
  }
  const clientId = quote.clientRef || refs.clientRef;
  const clientFilter = clientId ? { _id: clientId } : lead?._id ? { selectedLead: lead._id } : null;
  const client = clientFilter ? await Client.findOne(clientFilter).select('data.basic data.compliance data.selectedLeadSnapshot').lean() : null;
  const leadDetails = invoicePartyDetails(quote.leadDetails, client || {}, lead || {});
  return { quote, lead, items, leadDetails, poYearRows: [...orders.values()] };
}
exports.eligibleQuotation = async (req, res) => {
  const scope = await getVisibleUserScope(req.user);
  const visible = await Quotation.exists({ _id: req.params.id, ...(scope === null ? {} : { createdBy: { $in: scope.ids } }) });
  if (!visible) return res.status(404).json({ error: 'Quotation not found or not accessible.' });
  const context = await quotationContext(req.params.id);
  return res.json({ ok: true, items: context.items || [], leadDetails: context.leadDetails, poYearRows: context.poYearRows || [] });
};
async function validateInvoice(payload, editingId, user) {
  if (!(payload.paymentPercentage > 0 && payload.paymentPercentage <= 100)) return 'Select a payment percentage greater than 0 and up to 100.';
  if (!payload.quotationId) return 'Select a quotation.';
  const scope = await getVisibleUserScope(user);
  if (!await Quotation.exists({ _id: payload.quotationId, ...(scope === null ? {} : { createdBy: { $in: scope.ids } }) })) return 'Quotation not found or not accessible.';
  const { quote, items, poYearRows, leadDetails } = await quotationContext(payload.quotationId);
  if (!quote) return 'Selected quotation was not found.';
  if (text(payload.poNumber) && text(payload.poNumber).toUpperCase() === text(quote.quotationNumber).toUpperCase()) {
    return 'PO Number must be different from the quotation number.';
  }
  if (!applyLeadPoRows(payload, poYearRows, quote.quotationNumber)) { payload.poYearRows = []; payload.poYearCount = 0; }
  for (const item of payload.items) {
    if (item.sourceItemIndex != null) continue;
    const matches = items.filter(eligible => ['serviceCategory', 'piboCategory', 'servicesOffered', 'servicesForYear'].every(key => text(eligible[key]) === text(item[key])));
    if (matches.length === 1) item.sourceItemIndex = matches[0].sourceItemIndex;
  }
  if (new Set(payload.items.map(item => item.sourceItemIndex)).size !== payload.items.length) return 'Each quotation service can appear only once.';
  if (payload.items.some(item => !items.some(eligible => eligible.sourceItemIndex === item.sourceItemIndex))) return 'Only services from the selected quotation can be invoiced. Reload the quotation.';
  const previous = await ProformaInvoice.find({ quotationId: payload.quotationId, status: { $ne: 'cancelled' }, ...(editingId ? { _id: { $ne: editingId } } : {}) }).select('items paymentPercentage').lean();
  for (const item of payload.items) {
    const billed = previous.filter(row => row.items.some(old => old.sourceItemIndex === item.sourceItemIndex || (old.sourceItemIndex == null && old.serviceCategory === item.serviceCategory && old.piboCategory === item.piboCategory))).reduce((sum, row) => sum + (row.paymentPercentage ?? 100), 0);
    if (billed + payload.paymentPercentage > 100.001) return `Only ${Math.max(0, 100 - billed)}% remains for ${item.serviceCategory}.`;
  }
  payload.leadDetails = invoicePartyDetails(payload.leadDetails, { data: { basic: leadDetails } });
  payload.quotationNumber = quote.quotationNumber;
  Object.assign(payload, await resolveCrmRelationships(payload));
  return '';
}
