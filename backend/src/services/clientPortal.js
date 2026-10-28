const mongoose = require('mongoose');
const Lead = require('../models/Lead');
const Client = require('../models/Client');
const Quotation = require('../models/Quotation');
const ProformaInvoice = require('../models/ProformaInvoice');
const User = require('../models/User');
const pick = (source = {}, fields = '') => Object.fromEntries(fields.split(' ').filter(key => source?.[key] !== undefined).map(key => [key, source[key]]));
const id = value => String(value?._id || value || '');
const array = value => Array.isArray(value) ? value : [];
function contactEmailFilter(email) {
  const escaped = String(email).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const exact = new RegExp(`^\\s*${escaped}\\s*$`, 'i');
  return {
    $or: [{
      'contacts.emails': exact
    }, {
      'contacts.email': exact
    }, {
      $and: [{ $or: [{ contacts: { $exists: false } }, { contacts: { $size: 0 } }, { contacts: null }] }, { emails: exact }]
    }]
  };
}
function relationshipFilter(leads, clients) {
  const leadIds = leads.map(lead => lead._id),
    clientIds = clients.map(client => client._id);
  const legacyIds = [...new Set(leads.flatMap(lead => [id(lead), lead.leadCode, lead.sourceLeadId, lead.externalLeadId]).filter(Boolean))];
  return {
    $or: [{
      leadRef: {
        $in: leadIds
      }
    }, {
      leadRef: null,
      clientRef: {
        $in: clientIds
      }
    }, ...['leadId', 'leadCode', 'businessLeadCode'].map(field => ({
      leadRef: null,
      clientRef: null,
      [field]: {
        $in: legacyIds
      }
    }))]
  };
}
function safeFile(value) {
  const raw = typeof value === 'string' ? value : value?.secureUrl || value?.url || '';
  try {
    const url = new URL(raw);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}
function toDocument(row, kind) {
  return {
    ...pick(row, '_id companyName leadId leadCode quotationNumber proformaNumber quotationDate invoiceDate validUntil pricingMode combinedBasicAmount subtotal grandTotal gstRate gstAmount status terms paymentTerm invoiceDetails'),
    kind,
    leadDetails: pick(row.leadDetails, 'companyName contactPerson designation addressLine1 addressLine2 addressLine3 state city pinCode gstNumber'),
    items: array(row.items).map(item => pick(item, 'serviceCategory eprCategory servicesOffered servicesForYear financialYear registrationYear annualReturnYears unit basicAmount applicantType subApplicantType piboCategory periodUnit servicePeriod serviceStartDate serviceEndDate'))
  };
}
function publicDetails(value, depth = 0) {
  if (depth > 8) return undefined;
  if (Array.isArray(value)) return value.map(entry => publicDetails(entry, depth + 1)).filter(entry => entry !== undefined);
  if (!value || typeof value !== 'object') return typeof value === 'string' && (value.startsWith('data:') || value.length > 20000) ? undefined : value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !/password|secret|token|credential|login|ceprUserId|otp|internal|remark|note|createdBy|updatedBy|storageKey|publicId|^_id$/i.test(key)).map(([key, entry]) => [key, publicDetails(entry, depth + 1)]).filter(([, entry]) => entry !== undefined));
}
function clientMasterDetails(data = {}) {
  return Object.fromEntries(['basic', 'registeredAddress', 'communicationAddress', 'compliance', 'msmeRows', 'cte', 'authorised', 'coordinating', 'annualReturn'].filter(key => data[key] !== undefined).map(key => [key, publicDetails(data[key])]).concat([['cpcb', pick(data.cpcb, 'registrationNumber status approvalStatus applicationStatus processingStatus')]]));
}
function allocationRows(client) {
  return Object.entries(client.serviceAllocations || {}).map(([service, entry]) => ({
    serviceCategory: service,
    assignedStaff: typeof entry === 'object' ? entry?.userId || entry?.userIdString || entry?.user || entry?.assignedTo || entry?.assigneeId || entry?.assignedUserId : entry,
    assignedStaffText: entry?.userName || entry?.assignedUserName || entry?.assigneeName || '',
    assignedStaffEmail: entry?.userEmail || entry?.email || ''
  }));
}
function buildPortalData(email, leads, clients, quotations, invoices, users = []) {
  const userMap = new Map(users.map(user => [id(user), pick(user, 'name email role contactNumber')]));
  const spoc = (source = {}, lead = {}) => {
    if (!source.assignedStaff && !source.assignedTo && !source.assignedStaffText && !source.assignedToText) {
      source = array(lead.assignments).find(assignment => assignment.assignedStaff || assignment.assignedStaffText) || array(lead.assignments).find(assignment => assignment.assignedTo || assignment.assignedToText) || source;
    }
    const hasAssignment = source.assignedStaff || source.assignedTo || source.assignedStaffText || source.assignedToText;
    const ref = hasAssignment ? source.assignedStaff || source.assignedTo : lead.assignedStaff || lead.assignedTo || lead.generatedForUser || lead.createdBy;
    const user = userMap.get(id(ref));
    return user || {
      name: source.assignedStaffText || source.assignedToText || lead.assignedStaffText || lead.assignedToText || lead.generatedForName || lead.createdByName || 'Not assigned',
      email: source.assignedStaffEmail || source.assignedToEmail || lead.assignedStaffEmail || lead.generatedForEmail || lead.createdByEmail || ''
    };
  };
  const records = leads.map(lead => ({
    ...pick(lead, '_id leadCode company emails salutation contactPerson designation mobileNo1 mobileNo2 whatsappNo linkedinUrl industryType eprCategory applicantType subApplicantType servicesOffered addressLine1 addressLine2 addressLine3 landmark state city pinCode website gstNumber'),
    contacts: (array(lead.contacts).length ? lead.contacts : [lead]).map(contact => pick(contact, 'plantUnit salutation contactPerson designation emails email mobileNo1 mobileNo2 whatsappNo linkedinUrl')),
    addresses: array(lead.addresses).map(address => pick(address, 'plantUnit unit unitName addressLine1 addressLine2 addressLine3 landmark state city pinCode gstNumber')),
    services: (array(lead.serviceSelections).length ? lead.serviceSelections : [lead]).map(service => pick(service, 'plantUnit assignedServiceId serviceCategory eprCategory applicantType subApplicantType servicesOffered financialYear')),
    spoc: spoc({}, lead),
    assignments: [...array(lead.assignments), ...clients.filter(client => id(client.selectedLead) === id(lead)).flatMap(allocationRows)].map(assignment => ({
      ...pick(assignment, 'plantUnit assignedServiceId serviceCategory eprCategory servicesOffered applicantType subApplicantType poStatus'),
      spoc: spoc(assignment, lead)
    })),
    clientMaster: clients.filter(client => id(client.selectedLead) === id(lead)).map(client => ({
      id: id(client),
      ...pick(client.data, 'companyName company gstNumber panNumber cinNumber addressLine1 addressLine2 addressLine3 city state pinCode website industryType eprCategory applicantType subApplicantType servicesOffered'),
      ...clientMasterDetails(client.data)
    }))
  }));
  const pos = new Map();
  function addPo(po, lead, source, owner) {
    const file = safeFile(po.poFileUrl || po.compliancePoFile);
    if (!po.poNumber && !file) return;
    const company = lead?.company || source.companyName || '';
    const key = [id(lead) || company, file || po.poNumber, po.fy || po.poFinancialYear || ''].join('|');
    const entry = {
      company,
      leadCode: lead?.leadCode || source.leadCode || '',
      poNumber: po.poNumber || '',
      financialYear: po.fy || po.poFinancialYear || '',
      date: po.poDate || po.compliancePoDate || '',
      receivedDate: po.poReceivedDate || '',
      amount: Number(po.poAmount ?? po.value ?? 0),
      quotationNumber: po.quotationNumber || po.quotationNo || source.quotationNumber || '',
      services: array(po.services || po.serviceCategory).map(service => typeof service === 'string' ? service : service.serviceCategory || service.servicesOffered || service.eprCategory || '').filter(Boolean),
      fileUrl: file,
      fileName: po.poFileName || po.compliancePoFile?.name || 'View PO',
      spoc: owner
    };
    if (!pos.has(key)) pos.set(key, entry);
  }
  leads.forEach(lead => array(lead.assignments).forEach(assignment => array(assignment.poYearRows).forEach(po => addPo(po, lead, lead, spoc(assignment, lead)))));
  invoices.forEach(invoice => {
    const linkedClient = clients.find(client => id(client) === id(invoice.clientRef));
    const lead = leads.find(lead => id(lead) === id(invoice.leadRef) || id(lead) === id(linkedClient?.selectedLead) || [id(lead), lead.leadCode, lead.externalLeadId, lead.sourceLeadId].filter(Boolean).some(value => value === invoice.leadId || value === invoice.leadCode));
    array(invoice.poYearRows).forEach(po => addPo(po, lead, invoice, spoc({}, lead)));
  });
  const purchaseOrders = [...pos.values()];
  return {
    email,
    clients: records,
    purchaseOrders,
    quotations: quotations.map(row => toDocument(row, 'quotation')),
    invoices: invoices.map(row => toDocument(row, 'pi')),
    summary: {
      companies: new Set(records.map(record => String(record.company || record._id).trim().toLowerCase())).size,
      purchaseOrders: purchaseOrders.length,
      uploadedPurchaseOrders: purchaseOrders.filter(po => po.fileUrl).length,
      quotations: quotations.length,
      invoices: invoices.length,
      poValue: purchaseOrders.reduce((sum, po) => sum + po.amount, 0)
    }
  };
}
async function loadPortalData(email) {
  const leads = await Lead.find(contactEmailFilter(email)).select('leadCode sourceLeadId externalLeadId company emails salutation contactPerson designation mobileNo1 mobileNo2 whatsappNo linkedinUrl industryType eprCategory applicantType subApplicantType servicesOffered addressLine1 addressLine2 addressLine3 landmark state city pinCode website contacts addresses serviceSelections assignments assignedTo assignedStaff assignedToText assignedStaffText assignedStaffEmail generatedForUser generatedForName generatedForEmail createdBy createdByName createdByEmail').lean();
  if (!leads.length) return buildPortalData(email, [], [], [], []);
  const clients = await Client.find({
    selectedLead: {
      $in: leads.map(lead => lead._id)
    }
  }).select('selectedLead data serviceAllocations').lean();
  const filter = relationshipFilter(leads, clients);
  const [quotations, invoices, users] = await Promise.all([Quotation.find({
    ...filter,
    status: {
      $in: ['sent', 'admin_approved', 'approved']
    }
  }).select('-revisionHistory -managementApproval -approvalDecision -scopeOfWork').sort({
    createdAt: -1
  }).lean(), ProformaInvoice.find({
    ...filter,
    status: 'issued'
  }).select('-scopeOfWork -createdBy').sort({
    createdAt: -1
  }).lean(), User.find({
    _id: {
      $in: [...new Set([...leads.flatMap(lead => [lead.assignedStaff, lead.assignedTo, lead.generatedForUser, lead.createdBy, ...array(lead.assignments).flatMap(a => [a.assignedStaff, a.assignedTo])]), ...clients.flatMap(allocationRows).map(a => a.assignedStaff)].filter(Boolean).map(id).filter(value => mongoose.Types.ObjectId.isValid(value)))]
    }
  }).select('name email role contactNumber').lean()]);
  return buildPortalData(email, leads, clients, quotations, invoices, users);
}
module.exports = {
  contactEmailFilter,
  relationshipFilter,
  safeFile,
  buildPortalData,
  loadPortalData
};
