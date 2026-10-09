const crypto = require('crypto');
const Lead = require('../models/Lead');
const Client = require('../models/Client');
const Quotation = require('../models/Quotation');
const { getVisibleUserScope, ownerFilter } = require('../utils/visibilityScope');

const MIME_BY_EXTENSION = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  webp: 'image/webp', gif: 'image/gif', doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
};

const text = (value) => String(value ?? '').trim();
const idText = (value) => text(value?._id ?? value?.id ?? value);

function asIso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function inferMimeType(fileName, storedMimeType) {
  if (text(storedMimeType)) return text(storedMimeType);
  const extension = text(fileName).toLowerCase().split('.').pop();
  return MIME_BY_EXTENSION[extension] || null;
}

function serviceObject(value) {
  if (value && typeof value === 'object') {
    return { id: idText(value) || null, name: text(value.name || value.label || value.servicesOffered || value.applicableService) };
  }
  return { id: null, name: text(value) };
}

function stablePoId(leadId, assignmentIndex, rowIndex) {
  return `po_${crypto.createHash('sha256').update(`${leadId}:${assignmentIndex}:${rowIndex}`).digest('hex').slice(0, 24)}`;
}

async function leanFind(Model, filter = {}, projection) {
  const query = Model.find(filter);
  if (projection && typeof query?.select === 'function') query.select(projection);
  if (typeof query?.maxTimeMS === 'function') query.maxTimeMS(20000);
  return typeof query?.lean === 'function' ? query.lean() : query;
}

// Monthly reads must not pull embedded PO proofs, invoices or client uploads
// into Node. Preserve proof-only entries with a boolean presence marker.
const monthlyLeadProjection = {
  _id: 1, leadCode: 1, company: 1, companyName: 1, createdBy: 1,
  createdByName: 1, closedAt: 1, closedBy: 1, createdAt: 1, updatedAt: 1,
  applicantType: 1, subApplicantType: 1, piboParent: 1, piboCategory: 1,
  serviceSelections: { $map: {
    input: { $cond: [{ $isArray: '$serviceSelections' }, '$serviceSelections', []] }, as: 'service',
    in: Object.fromEntries('assignedServiceId serviceAssignmentId assignmentId applicantType piboParent subApplicantType piboCategory'.split(' ').map(field => [field, `$$service.${field}`]))
  } },
  assignments: { $map: {
    input: { $cond: [{ $isArray: '$assignments' }, '$assignments', []] }, as: 'assignment',
    in: {
      ...Object.fromEntries('assignedServiceId serviceAssignmentId assignmentId closedBy closedByText closureRequestedBy closureRequestedByText assignedTo assignedToText assignedStaff assignedStaffText closedAt poApprovalStatus'.split(' ').map(field => [field, `$$assignment.${field}`])),
      poYearRows: { $map: {
        input: { $cond: [{ $isArray: '$$assignment.poYearRows' }, '$$assignment.poYearRows', []] }, as: 'po',
        in: {
          ...Object.fromEntries('poNumber poDate poAmount quotationId quotationNumber quotationNo createdAt updatedAt'.split(' ').map(field => [field, `$$po.${field}`])),
          poFileUrl: { $cond: [{ $ne: [{ $ifNull: ['$$po.poFileUrl', ''] }, ''] }, 'proof-present', ''] }
        }
      } }
    }
  } }
};

function quotationMatchesLead(quotation, lead) {
  const candidates = [quotation.leadRef, quotation.leadId, quotation.leadCode, quotation.businessLeadCode].map(idText).filter(Boolean);
  return candidates.includes(idText(lead)) || candidates.includes(text(lead.leadCode));
}

function resolveQuotation(row, lead, quotations) {
  const rowQuotationId = idText(row.quotationId);
  const rowQuotationNumber = text(row.quotationNumber || row.quotationNo);
  return quotations.find((quotation) => rowQuotationId && idText(quotation) === rowQuotationId)
    || quotations.find((quotation) => rowQuotationNumber && text(quotation.quotationNumber) === rowQuotationNumber)
    || quotations.find((quotation) => quotationMatchesLead(quotation, lead))
    || null;
}

async function loadPurchaseOrders(models, leadFilter = {}, options = {}) {
  const compact = options.monthly === true;
  const leads = compact && typeof models.Lead.aggregate === 'function'
    ? await models.Lead.aggregate([{ $match: leadFilter }, { $project: monthlyLeadProjection }]).option({ maxTimeMS: 20000 })
    : await leanFind(models.Lead, leadFilter);
  const leadIds = (leads || []).map(idText).filter(Boolean);
  const leadCodes = (leads || []).map((lead) => text(lead.leadCode)).filter(Boolean);
  if (!leadIds.length && !leadCodes.length) return [];
  const quotationLookup = [];
  if (leadIds.length) quotationLookup.push({ leadRef: { $in: leadIds } }, { leadId: { $in: leadIds } });
  if (leadCodes.length) quotationLookup.push({ leadCode: { $in: leadCodes } }, { businessLeadCode: { $in: leadCodes } });
  const [clients, quotations] = await Promise.all([
    leanFind(models.Client, { selectedLead: { $in: leadIds } }, compact ? '_id selectedLead' : undefined),
    leanFind(models.Quotation, { $or: quotationLookup }, compact ? '_id leadRef leadId leadCode businessLeadCode quotationNumber grandTotal' : undefined)
  ]);
  const clientByLead = new Map();
  for (const client of clients || []) {
    const leadId = idText(client.selectedLead);
    if (leadId && !clientByLead.has(leadId)) clientByLead.set(leadId, idText(client));
  }

  const records = [];
  for (const lead of leads || []) {
    const leadId = idText(lead);
    for (const [assignmentIndex, assignment] of (Array.isArray(lead.assignments) ? lead.assignments : []).entries()) {
      if (!assignment || typeof assignment !== 'object') continue;
      for (const [rowIndex, row] of (Array.isArray(assignment.poYearRows) ? assignment.poYearRows : []).entries()) {
        if (!row || typeof row !== 'object') continue;
        if (!text(row.poNumber) && !text(row.poFileUrl)) continue;
        const quotation = resolveQuotation(row, lead, quotations || []);
        const services = (Array.isArray(row.services) ? row.services : [])
          .map(serviceObject).filter((service) => service.name);
        const firstService = services[0] || null;
        const selectionId = value => idText(value?.assignedServiceId || value?.serviceAssignmentId || value?.assignmentId);
        const assignedId = selectionId(assignment);
        const selections = Array.isArray(lead.serviceSelections) ? lead.serviceSelections : [];
        const leadService = (assignedId ? selections.find(service => selectionId(service) === assignedId) : null)
          || selections[assignmentIndex] || {};
        const poAmount = Number(row.poAmount);
        const fallbackAmount = Number(quotation?.grandTotal);
        const createdAt = asIso(row.createdAt || lead.createdAt);
        const updatedAt = asIso(row.updatedAt || lead.updatedAt);
        records.push({
          id: stablePoId(leadId, assignmentIndex, rowIndex),
          leadId,
          leadNumber: text(lead.leadCode) || null,
          clientId: clientByLead.get(leadId) || null,
          quotationId: idText(quotation) || idText(row.quotationId) || null,
          quotationNumber: text(row.quotationNumber || row.quotationNo || quotation?.quotationNumber) || null,
          poNumber: text(row.poNumber) || null,
          poDate: asIso(row.poDate),
          poAmount: Number.isFinite(poAmount) && poAmount > 0 ? poAmount : (Number.isFinite(fallbackAmount) ? fallbackAmount : null),
          currency: text(row.currency) || 'INR',
          financialYear: text(row.fy) || null,
          clientName: text(lead.company || lead.companyName) || 'Untitled client',
          applicantType: text(leadService.applicantType || leadService.piboParent || lead.applicantType || lead.piboParent) || 'Not specified',
          subApplicantType: text(leadService.subApplicantType || leadService.piboCategory || lead.subApplicantType || lead.piboCategory) || 'Not specified',
          ownerId: idText(assignment.closedBy || assignment.closureRequestedBy || assignment.assignedTo || assignment.assignedStaff || lead.createdBy) || null,
          ownerName: text(assignment.closedByText || assignment.closureRequestedByText || assignment.assignedToText || assignment.assignedStaffText || lead.createdByName) || 'Unassigned',
          isClosed: Boolean(assignment.closedAt || assignment.closedBy || assignment.closedByText || (lead.serviceSelections?.length === 1 && (lead.closedAt || lead.closedBy))),
          companyIdentity: lead.companyIdentity || '',
          approvalStatus: text(assignment.poApprovalStatus).toUpperCase() || 'PENDING',
          services: services.length ? services : [serviceObject(leadService.servicesOffered || leadService.applicableService || assignment.servicesOffered)].filter((service) => service.name),
          service: firstService,
          poProof: text(row.poFileUrl) ? {
            url: text(row.poFileUrl),
            fileName: text(row.poFileName) || null,
            mimeType: inferMimeType(row.poFileName, row.poFileMimeType),
            size: row.poFileSize !== null && row.poFileSize !== undefined && row.poFileSize !== ''
              && Number.isFinite(Number(row.poFileSize)) && Number(row.poFileSize) >= 0 ? Number(row.poFileSize) : null
          } : null,
          poReceivedDate: asIso(row.poReceivedDate || assignment.closedAt || lead.closedAt || lead.updatedAt),
          createdAt,
          updatedAt
        });
      }
    }
  }
  return records;
}

function createPurchaseOrderController(models = { Lead, Client, Quotation }) {
  return {
    async list(req, res) {
      const scope = await getVisibleUserScope(req.user);
      const leadFilter = ownerFilter(scope, 'createdBy', 'assignedTo', [
        'createdByCrmUserId', 'createdByEmail', 'createdByName', 'assignedToText',
        'assignedStaffText', 'assignedStaffEmail', 'assignments.assignedToText',
        'assignments.assignedToEmail', 'serviceSelections.createdByCrmUserId',
        'serviceSelections.createdByEmail', 'serviceSelections.createdByName'
      ], ['assignedStaff', 'assignments.assignedTo', 'assignments.assignedStaff']);
      let records = await loadPurchaseOrders(models, leadFilter);
      const query = req.query || {};
      if (text(query.leadId)) records = records.filter((row) => row.leadId === text(query.leadId));
      if (text(query.clientId)) records = records.filter((row) => row.clientId === text(query.clientId));
      if (text(query.quotationId)) records = records.filter((row) => row.quotationId === text(query.quotationId));
      if (text(query.poNumber)) {
        const needle = text(query.poNumber).toLowerCase();
        records = records.filter((row) => text(row.poNumber).toLowerCase().includes(needle));
      }
      records.sort((left, right) => new Date(right.poReceivedDate || right.updatedAt || 0) - new Date(left.poReceivedDate || left.updatedAt || 0));
      const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
      const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 20));
      const total = records.length;
      return res.json({
        success: true,
        message: 'Purchase orders fetched successfully',
        data: records.slice((page - 1) * limit, page * limit),
        pagination: { page, limit, total, totalPages: total ? Math.ceil(total / limit) : 0 }
      });
    },

    async getOne(req, res) {
      const scope = await getVisibleUserScope(req.user);
      const leadFilter = ownerFilter(scope, 'createdBy', 'assignedTo', [
        'createdByCrmUserId', 'createdByEmail', 'createdByName', 'assignedToText',
        'assignedStaffText', 'assignedStaffEmail', 'assignments.assignedToText',
        'assignments.assignedToEmail', 'serviceSelections.createdByCrmUserId',
        'serviceSelections.createdByEmail', 'serviceSelections.createdByName'
      ], ['assignedStaff', 'assignments.assignedTo', 'assignments.assignedStaff']);
      const record = (await loadPurchaseOrders(models, leadFilter)).find((row) => row.id === text(req.params?.id));
      if (!record) return res.status(404).json({ success: false, message: 'Purchase order not found' });
      return res.json({ success: true, message: 'Purchase order fetched successfully', data: record });
    }
  };
}

module.exports = {
  ...createPurchaseOrderController(), createPurchaseOrderController, loadPurchaseOrders,
  inferMimeType, stablePoId, monthlyLeadProjection
};
