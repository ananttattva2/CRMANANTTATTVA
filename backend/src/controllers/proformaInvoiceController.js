const ProformaInvoice = require('../models/ProformaInvoice');
const { resolvePoProof } = require('../services/poProofResolver');
const Lead = require('../models/Lead');
const { eligibleItems, assignmentForService, poRowsForQuotation } = require('../services/proformaEligibility');
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
  const [latest] = await ProformaInvoice.aggregate([
    { $match: { proformaNumber: new RegExp(`^PI/${fy}/\\d+$`, 'i') } },
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
  return `PI/${fy}/${String(sequence).padStart(3, '0')}`;
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
  return res.json({ ok: true, proformaInvoices: rows });
};

async function visibleEmailInvoice(req) {
  const scope = await getVisibleUserScope(req.user);
  const invoice = await ProformaInvoice.findOne({ _id: req.params.id, ...(scope === null ? {} : { createdBy: { $in: scope.ids } }) }).populate('createdBy', 'name email').lean();
  if (!invoice) throw Object.assign(new Error('Invoice not found or not accessible.'), { status: 404 });
  if (invoice.status === 'cancelled') throw Object.assign(new Error('Cancelled invoices cannot be emailed.'), { status: 400 });
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

exports.create = async (req, res) => {
  const payload = cleanPayload(req.body);
  if (!payload.companyName) return res.status(400).json({ error: 'Company Name is required.' });
  if (!payload.quotationNumber) return res.status(400).json({ error: 'Quotation Number is required.' });
  if (!payload.items.length) return res.status(400).json({ error: 'At least one invoice item is required.' });
  const validationError = await validateInvoice(payload, null, req.user);
  if (validationError) return res.status(400).json({ error: validationError });
  const row = await ProformaInvoice.create({ ...payload, proformaNumber: await nextProformaNumber(), createdBy: req.user?._id });
  await row.populate('createdBy', 'name email');
  return res.status(201).json({ ok: true, proformaInvoice: row });
};

exports.update = async (req, res) => {
  const scope = await getVisibleUserScope(req.user);
  const row = await ProformaInvoice.findOne({ _id: req.params.id, ...(scope === null ? {} : { createdBy: { $in: scope.ids } }) });
  if (!row) return res.status(404).json({ error: 'Proforma Invoice not found or not accessible.' });
  const payload = cleanPayload(req.body);
  if (!payload.companyName || !payload.quotationNumber || !payload.items.length) {
    return res.status(400).json({ error: 'Company, PO Number, Quotation Number and at least one item are required.' });
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
  const items = lead ? eligibleItems(quote, lead) : [];
  const orders = new Map();
  for (const item of items) {
    const assignment = assignmentForService(lead, item.assignedServiceId, item.sourceServiceIndex, lead.serviceSelections?.length || 1);
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
  return { quote, lead, items, poYearRows: [...orders.values()] };
}
exports.eligibleQuotation = async (req, res) => {
  const scope = await getVisibleUserScope(req.user);
  const visible = await Quotation.exists({ _id: req.params.id, ...(scope === null ? {} : { createdBy: { $in: scope.ids } }) });
  if (!visible) return res.status(404).json({ error: 'Quotation not found or not accessible.' });
  const context = await quotationContext(req.params.id);
  return res.json({ ok: true, items: context.items || [], poYearRows: context.poYearRows || [] });
};
async function validateInvoice(payload, editingId, user) {
  if (!(payload.paymentPercentage > 0 && payload.paymentPercentage <= 100)) return 'Select a payment percentage greater than 0 and up to 100.';
  if (!payload.quotationId) return 'Select a quotation with closed services and uploaded PO proof.';
  const scope = await getVisibleUserScope(user);
  if (!await Quotation.exists({ _id: payload.quotationId, ...(scope === null ? {} : { createdBy: { $in: scope.ids } }) })) return 'Quotation not found or not accessible.';
  const { quote, items, poYearRows } = await quotationContext(payload.quotationId);
  if (!quote) return 'Selected quotation was not found.';
  if (text(payload.poNumber) && text(payload.poNumber).toUpperCase() === text(quote.quotationNumber).toUpperCase()) {
    return 'PO Number must be different from the quotation number.';
  }
  if (!applyLeadPoRows(payload, poYearRows, quote.quotationNumber)) return 'No distinct PO number was found on the selected lead. Enter the actual PO number while closing the lead, then reload this quotation.';
  for (const item of payload.items) {
    if (item.sourceItemIndex != null) continue;
    const matches = items.filter(eligible => ['serviceCategory', 'piboCategory', 'servicesOffered', 'servicesForYear'].every(key => text(eligible[key]) === text(item[key])));
    if (matches.length === 1) item.sourceItemIndex = matches[0].sourceItemIndex;
  }
  if (new Set(payload.items.map(item => item.sourceItemIndex)).size !== payload.items.length) return 'Each quotation service can appear only once.';
  if (payload.items.some(item => !items.some(eligible => eligible.sourceItemIndex === item.sourceItemIndex))) return 'Only PO-uploaded, closed services can be invoiced. Reload the quotation.';
  const previous = await ProformaInvoice.find({ quotationId: payload.quotationId, status: { $ne: 'cancelled' }, ...(editingId ? { _id: { $ne: editingId } } : {}) }).select('items paymentPercentage').lean();
  for (const item of payload.items) {
    const billed = previous.filter(row => row.items.some(old => old.sourceItemIndex === item.sourceItemIndex || (old.sourceItemIndex == null && old.serviceCategory === item.serviceCategory && old.piboCategory === item.piboCategory))).reduce((sum, row) => sum + (row.paymentPercentage ?? 100), 0);
    if (billed + payload.paymentPercentage > 100.001) return `Only ${Math.max(0, 100 - billed)}% remains for ${item.serviceCategory}.`;
  }
  payload.quotationNumber = quote.quotationNumber;
  Object.assign(payload, await resolveCrmRelationships(payload));
  return '';
}
