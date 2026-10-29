import * as XLSX from 'xlsx';

const annualDraftLegacyKeys = {
  'basic.eprCertificateNo': 'EPR Certificate No.',
  'basic.cpcbRegistrationNumber': 'CPCB Registration Number',
  'basic.applicationApprovalDate': 'Date of Application Approval',
  'basic.plantLocation': 'Plant Location',
  'basic.gstNumber': 'GST Number',
  'basic.panNumber': 'PAN',
  'basic.organisationLegalName': 'Name of the Organisation (Legal Name)',
  'basic.tradeName': 'Trade Name',
  'basic.registeredAddress': 'Registered Address',
  'basic.postalAddress': 'Postal Address',
  'basic.companyPan': "Company's PAN",
  'basic.companyGst': "Company's GST",
  'basic.typeOfBusiness': 'Type of Business',
  'basic.cpcbLoginId': 'CPCB Login ID',
  'basic.cpcbLoginPassword': 'CPCB Login Password',
  'basic.cpcbStatus': 'CPCB Status',
  'basic.authorisedPersonName': 'Authorised Contact Person',
  'basic.authorisedPersonDesignation': 'Authorised Person Designation',
  'basic.otpMobile': 'OTP Enabled Mobile No.',
  'basic.authorisedPersonEmail': 'Email Id',
  'basic.authorisedPersonPan': 'PAN Number',
  'financials.quotationNo': 'Quotation No.',
  'financials.quotationDate': 'Quotation Date',
  'financials.quotationFile': 'Quotation File',
  'financials.slaNo': 'Compliance SLA No.',
  'financials.slaDate': 'SLA Date',
  'financials.slaFile': 'Upload SLA',
  'financials.compliancePoNo': 'Compliance PO No.',
  'financials.compliancePoDate': 'Compliance PO Date',
  'financials.compliancePoFile': 'Upload Compliance PO',
  'financials.complianceAmountReceived': 'Compliance Amount Received',
  'financials.receivedThrough': 'Received Through',
  'financials.receivedDate': 'Received Date',
  'financials.amountStatus': 'Amount Status',
  'data.applicationRenewal': 'Application is for Renewal',
  'data.registrationNumber': 'Registration No.',
  'data.dateOfIssue': 'Date of Issue',
  'data.validityOfRegistration': 'Validity of Registration',
  'data.producerRegistrationCapacity': 'Producer Registration Capacity',
  'data.districtIndustryCentreRegistered': 'Registered with District Industries Centre',
  'data.productionFacility': 'Producer have a Production Facility',
  'data.registrationCopy': 'Registration Copy',
  'brandOwner.productionFacility': 'Brand Owner have a Production Facility',
  'brandOwner.applicationRenewal': 'Application is for Renewal',
  'brandOwner.registrationNumber': 'Registration No.',
  'brandOwner.dateOfIssue': 'Date of Issue',
  'brandOwner.validityOfRegistration': 'Validity of Registration',
  'brandOwner.districtIndustryCentreRegistered': 'Registered with District Industries Centre',
  'brandOwner.registrationCopy': 'Registration Copy',
  'importer.productionFacility': 'Importer have a Production Facility',
  'importer.applicationRenewal': 'Application is for Renewal',
  'importer.registrationNumber': 'Registration No.',
  'importer.dateOfIssue': 'Date of Issue',
  'importer.validityOfRegistration': 'Validity of Registration',
  'importer.districtIndustryCentreRegistered': 'Registered with District Industries Centre',
  'importer.registrationCopy': 'Registration Copy',
  'data.totalCapitalInvested': 'Total Capital Invested',
  'data.commencementYear': 'Year of Commencement of Operation',
  'data.productPackagingMajorMaterial': 'Product Packaging Major / Used Image',
  'data.processFlowDiagram': 'Process Flow Diagram',
  'data.thicknessOfPlastic': 'Thickness of Plastic',
  'annual.filingStatus': 'Filing Status'
};

const annualDraftAliasLabels = {
  'data.productionFacility': ['Does Producer have Production Facility', 'Producer have Production Facility', 'Producer have a Production Facility'],
  'data.districtIndustryCentreRegistered': ['Registered with District Industries Centre / State Government / UT?', 'If Registered with District Industries Centre'],
  'brandOwner.productionFacility': ['Does Brand Owner have Production Facility', 'Brand Owner have Production Facility', 'Brand Owner have a Production Facility'],
  'brandOwner.districtIndustryCentreRegistered': ['Registered with District Industries Centre / State Government / UT?'],
  'importer.productionFacility': ['Does Importer have Production Facility', 'Importer have Production Facility', 'Importer have a Production Facility'],
  'importer.districtIndustryCentreRegistered': ['Registered with District Industries Centre / State Government / UT?']
};

function getAnnualDraftAliasValue(draft = {}, label = '') {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) return undefined;
  const normalizedCandidates = [
    label,
    annualDraftLegacyKeys[label],
    ...(annualDraftAliasLabels[label] || [])
  ]
    .filter(Boolean)
    .map(normalizeHeaderKey);

  if (!normalizedCandidates.length) return undefined;

  for (const [key, value] of Object.entries(draft)) {
    if (value === undefined || value === null) continue;
    if (normalizedCandidates.includes(normalizeHeaderKey(key))) return value;
  }
  return undefined;
}


function normalizeHeaderKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

function isFilled(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function buildValueLookup(source, prefix = '', lookup = {}) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return lookup;
  Object.entries(source).forEach(([key, value]) => {
    const ownKey = normalizeHeaderKey(key);
    const pathKey = normalizeHeaderKey(`${prefix} ${key}`);
    if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      buildValueLookup(value, `${prefix} ${key}`, lookup);
      return;
    }
    if (isFilled(value)) {
      if (!lookup[ownKey]) lookup[ownKey] = value;
      if (!lookup[pathKey]) lookup[pathKey] = value;
    }
  });
  return lookup;
}

function pickLookup(lookup, aliases) {
  for (const alias of aliases) {
    const value = lookup[normalizeHeaderKey(alias)];
    if (isFilled(value)) return value;
  }
  return '';
}

function mapFlatClientData(item) {
  const lookup = buildValueLookup(item);
  const cityPin = splitCityPin(pickLookup(lookup, ['City with PIN', 'City PIN', 'City PinCode']));
  const msmeRows = [1, 2, 3, 4, 5].map((number, index) => ({
    label: `MSME ${number}`,
    classificationYear: pickLookup(lookup, [`MSME ${number} Classification Year`, index === 0 ? 'MSME Classification Year' : '']),
    status: pickLookup(lookup, [`MSME ${number} Status`, index === 0 ? 'MSME Status' : '', `MSME ${number}`]),
    majorActivity: pickLookup(lookup, [`MSME ${number} Major Activity`, index === 0 ? 'MSME Major Activity' : '']),
    udyamNumber: pickLookup(lookup, [`MSME ${number} Udyam Number`, index === 0 ? 'MSME Udyam Number' : '']),
    turnover: pickLookup(lookup, [`MSME ${number} Turnover`, index === 0 ? 'TurnOver of the Company (CR.)' : '']),
    value: pickLookup(lookup, [`MSME ${number}`])
  })).filter((row) => Object.values(row).some((value) => isFilled(value) && !/^MSME \d+$/.test(String(value))));

  return {
    companyOverview: {
      companyName: pickLookup(lookup, ['Company Overview Name', 'Company Name', 'Client Name', 'Client Legal Name', 'Legal Name', 'Name']),
      companySummary: pickLookup(lookup, ['Company Summary', 'Summary']),
      overviewItems: pickLookup(lookup, ['Overview Points', 'Company Details']) ? String(pickLookup(lookup, ['Overview Points', 'Company Details'])).split('|').map((item) => item.trim()).filter(Boolean) : [],
      productName: pickLookup(lookup, ['Product Name']),
      productManufacturer: pickLookup(lookup, ['Product Manufacturer']),
      category: pickLookup(lookup, ['Product Category', 'Category']),
      numberOfEmployees: pickLookup(lookup, ['Number of Employees'])
    },
    basic: {
      clientLegalName: pickLookup(lookup, ['Client Name', 'Client Legal Name', 'Legal Name', 'Company Name', 'Name']),
      tradeName: pickLookup(lookup, ['Trade Name', 'Company', 'Company Name']),
      companyType: pickLookup(lookup, ['Company Type', 'Company Constitution', 'Entity Type']),
      companyIndustry: pickLookup(lookup, ['Company Industry', 'Industry Type']),
      piboCategory: pickLookup(lookup, ['PIBO Category', 'PIBO']),
      eprCategory: pickLookup(lookup, ['EPR Category', 'EPR']),
      servicesOffered: pickLookup(lookup, ['Services Offered']),
      website: pickLookup(lookup, ['Website']),
      firstAnnualReturnYear: pickLookup(lookup, ['First Annual Return Year Applicable', 'First Annual Return Year', 'firstAnnualReturnYear', 'Annual Return Year'])
    },
    registeredAddress: {
      address1: pickLookup(lookup, ['Reg Address Line 1', 'Registered Address Line 1', 'Address Line 1', 'Address 1']),
      address2: pickLookup(lookup, ['Reg Address Line 2', 'Registered Address Line 2', 'Address Line 2', 'Address 2']),
      address3: pickLookup(lookup, ['Reg Address Line 3', 'Registered Address Line 3', 'Address Line 3', 'Address 3']),
      city: pickLookup(lookup, ['Reg City', 'Registered City', 'City']) || cityPin.city,
      state: pickLookup(lookup, ['Reg State', 'Registered State', 'State']),
      pincode: pickLookup(lookup, ['Reg PIN', 'Registered PIN', 'PIN', 'Pincode', 'Pin Code']) || cityPin.pin
    },
    communicationAddress: {
      address1: pickLookup(lookup, ['Comm Address Line 1', 'Communication Address Line 1']),
      address2: pickLookup(lookup, ['Comm Address Line 2', 'Communication Address Line 2']),
      address3: pickLookup(lookup, ['Comm Address Line 3', 'Communication Address Line 3']),
      city: pickLookup(lookup, ['Comm City', 'Communication City']),
      state: pickLookup(lookup, ['Comm State', 'Communication State']),
      pincode: pickLookup(lookup, ['Comm PIN', 'Communication PIN'])
    },
    compliance: {
      gst: pickLookup(lookup, ['GST Number', 'GST']),
      gstDate: pickLookup(lookup, ['GST Certificate Date']),
      cin: pickLookup(lookup, ['CIN']),
      cinDate: pickLookup(lookup, ['CIN Document Date']),
      pan: pickLookup(lookup, ['PAN']),
      panDate: pickLookup(lookup, ['PAN Document Date']),
      factoryLicense: pickLookup(lookup, ['Factory License No', 'Factory License Number']),
      factoryLicenseDate: pickLookup(lookup, ['Factory License Document Date']),
      eprCertificate: pickLookup(lookup, ['EPR Certificate No', 'EPR Certificate Number'])
    },
    msmeRows,
    cpcb: {
      registrationNumber: pickLookup(lookup, ['CPCB Reg No', 'CPCB Registration Number', 'CPCB Registration No', 'CPCB Application Number']),
      status: pickLookup(lookup, ['CPCB Status', 'CPCB Approval', 'CPCB Approval Status', 'CPCB Application Status', 'Application Processing Status', 'Portal Status']),
      ceprUserId: pickLookup(lookup, ['CEPR User ID']),
      ceprPassword: pickLookup(lookup, ['CEPR Password']),
      loginId: pickLookup(lookup, ['CPCB Login', 'CPCB Login ID']),
      loginPassword: pickLookup(lookup, ['CPCB Password'])
    },
    validation: {},
    otp: {
      mobile: pickLookup(lookup, ['OTP Mobile', 'OTP Mobile Number', 'OTP Mobile No', 'OTP Enabled Mobile No', 'Contact No', 'Contact Number', 'Mobile Number', 'Mobile']),
      personName: pickLookup(lookup, ['OTP Name', 'OTP Person Name', 'OTP Contact Name', 'Contact Person']),
      designation: pickLookup(lookup, ['Designation'])
    },
    authorised: {
      name: pickLookup(lookup, ['Auth Person Name', 'Authorised Person Name']),
      designation: pickLookup(lookup, ['Auth Person Designation', 'Authorised Person Designation']),
      mobile: pickLookup(lookup, ['Auth Person Mobile', 'Authorised Person Mobile']),
      email: pickLookup(lookup, ['Auth Person Email', 'Authorised Person Email', 'Email'])
    },
    coordinating: {
      name: pickLookup(lookup, ['Coord Person Name', 'Coordinating Person Name']),
      designation: pickLookup(lookup, ['Coord Person Designation', 'Coordinating Person Designation']),
      mobile: pickLookup(lookup, ['Coord Person Mobile', 'Coordinating Person Mobile']),
      email: pickLookup(lookup, ['Coord Person Email', 'Coordinating Person Email'])
    },
    importMeta: {
      uniqueId: pickLookup(lookup, ['Unique ID', 'UniqueId', 'Client ID']),
      leadNote: pickLookup(lookup, ['Lead Note']),
      leadNumber: pickLookup(lookup, ['Lead Number']),
      clientStatus: pickLookup(lookup, ['Client Status']),
      visibilityStatus: pickLookup(lookup, ['Visibility Status']),
      createdBy: pickLookup(lookup, ['Created By']),
      creationDate: pickLookup(lookup, ['Creation Date']),
      assignedTo: pickLookup(lookup, ['Assigned To', 'Assigned To Name', 'Assignee', 'Assignee Name']),
      approvedBy: pickLookup(lookup, ['Approved By'])
    }
  };
}

function mergeHydratedClientValue(primary, fallback) {
  if (Array.isArray(primary)) return primary.length ? primary : (Array.isArray(fallback) ? fallback : primary);
  if (primary instanceof Date) return primary;
  if (primary && typeof primary === 'object') {
    const fallbackObject = fallback && typeof fallback === 'object' && !Array.isArray(fallback) ? fallback : {};
    return [...new Set([...Object.keys(fallbackObject), ...Object.keys(primary)])].reduce((result, key) => {
      result[key] = mergeHydratedClientValue(primary[key], fallbackObject[key]);
      return result;
    }, {});
  }
  if (primary === false || primary === 0) return primary;
  if (primary !== undefined && primary !== null && String(primary).trim() !== '') return primary;
  return fallback;
}

function mergeClientData(primary = {}, fallback = {}) {
  // Client Master records exist in current nested data, legacy/root fields,
  // and assigned-service snapshots. Hydration must cover every current tab,
  // including document arrays and additional contacts, without allowing an
  // empty source value to erase a populated saved value.
  return mergeHydratedClientValue(primary || {}, fallback || {}) || {};
}

function readClientData(item) {
  const flatData = mapFlatClientData(item || {});
  return mergeClientData(item?.data || {}, flatData);
}

function normalizeClientIdentity(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\b(private|limited|pvt|ltd|llp|inc|company|co)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function hasMeaningfulIdentity(value) {
  const normalized = normalizeClientIdentity(value);
  return Boolean(normalized && !['n a', 'na', 'null', 'none', 'nil', 'not applicable', '-'].includes(normalized));
}

function getClientAliases(item) {
  const data = readClientData(item);
  const leadValue = hasMeaningfulIdentity(data.importMeta?.leadNumber) ? data.importMeta.leadNumber : item?.selectedLead?.leadCode;
  const aliases = [
    hasMeaningfulIdentity(data.importMeta?.uniqueId) && `uid:${normalizeClientIdentity(data.importMeta.uniqueId)}`,
    hasMeaningfulIdentity(leadValue) && `lead:${normalizeClientIdentity(leadValue)}`,
    data.authorised?.email && `email:${String(data.authorised.email).toLowerCase().trim()}`,
    data.coordinating?.email && `email:${String(data.coordinating.email).toLowerCase().trim()}`,
    data.otp?.mobile && `mobile:${String(data.otp.mobile).replace(/\D+/g, '')}`,
    data.basic?.clientLegalName && `client:${normalizeClientIdentity(data.basic.clientLegalName)}`,
    data.basic?.tradeName && `client:${normalizeClientIdentity(data.basic.tradeName)}`
  ].filter((alias) => alias && !alias.endsWith(':'));
  return [...new Set(aliases)];
}

function getClientStrongAliases(item) {
  return getClientAliases(item).filter((alias) => /^(uid|lead):/.test(alias));
}

function getClientWeakAliases(item) {
  return getClientAliases(item).filter((alias) => /^(email|mobile|client):/.test(alias));
}

function getClientSourceKey(item) {
  return getClientAliases(item)[0] || String(item?._id || item?.id || '').trim().toLowerCase();
}

function findClientByRouteKey(clients, routeKey) {
  const decodedKey = decodeURIComponent(String(routeKey || '')).trim();
  const normalizedKey = normalizeClientIdentity(decodedKey);
  if (!decodedKey) return null;

  return clients.find((item) => {
    const data = readClientData(item);
    const directKeys = [
      item?._id,
      item?.id,
      data.importMeta?.uniqueId,
      data.importMeta?.leadNumber,
      item?.selectedLead?.leadCode,
      getClientUniqueId(item)
    ].map((value) => String(value || '').trim()).filter(Boolean);

    if (directKeys.some((value) => value === decodedKey)) return true;
    return getClientAliases(item).some((alias) => alias.endsWith(`:${normalizedKey}`));
  }) || null;
}

function getClientCompletenessScore(item) {
  const data = readClientData(item);
  return [
    getClientUniqueId(item),
    data.basic?.clientLegalName,
    data.basic?.tradeName,
    data.registeredAddress?.state,
    getAssignedName(item),
    data.basic?.piboCategory,
    data.basic?.eprCategory,
    getMsmeSummary(data) !== 'N/A' ? getMsmeSummary(data) : '',
    data.cpcb?.status,
    data.otp?.mobile,
    data.otp?.personName
  ].filter((value) => value && value !== '-').length;
}

function mergeClientItems(existing, incoming) {
  const existingScore = getClientCompletenessScore(existing);
  const incomingScore = getClientCompletenessScore(incoming);
  const base = incomingScore >= existingScore ? incoming : existing;
  const fallback = incomingScore >= existingScore ? existing : incoming;

  return {
    ...fallback,
    ...base,
    adminControls: {
      ...(fallback.adminControls || {}),
      ...(base.adminControls || {})
    },
    data: mergeClientData(readClientData(base), readClientData(fallback))
  };
}

function mergeClientSources(crmClients, ccpClients) {
  const merged = [];
  const strongKeyIndex = new Map();
  const weakKeyIndex = new Map();

  [...ccpClients, ...crmClients].forEach((item) => {
    const strongAliases = getClientStrongAliases(item);
    const weakAliases = getClientWeakAliases(item);
    // Stable ATPL/Lead/CCP identities are authoritative. Never merge two
    // different stable IDs merely because company, email or assignee matches.
    const existingIndex = strongAliases.length
      ? strongAliases.map((alias) => strongKeyIndex.get(alias)).find((index) => index !== undefined)
      : weakAliases.map((alias) => weakKeyIndex.get(alias)).find((index) => index !== undefined);

    if (existingIndex !== undefined) {
      merged[existingIndex] = mergeClientItems(merged[existingIndex], item);
      getClientStrongAliases(merged[existingIndex]).forEach((alias) => strongKeyIndex.set(alias, existingIndex));
      if (!getClientStrongAliases(merged[existingIndex]).length) {
        getClientWeakAliases(merged[existingIndex]).forEach((alias) => weakKeyIndex.set(alias, existingIndex));
      }
      return;
    }

    const nextIndex = merged.length;
    strongAliases.forEach((alias) => strongKeyIndex.set(alias, nextIndex));
    if (!strongAliases.length) weakAliases.forEach((alias) => weakKeyIndex.set(alias, nextIndex));
    merged.push(item);
  });

  return merged;
}

function readCachedOrFreshList(result, listKey, cacheKey) {
  if (result.status === 'fulfilled') {
    const list = result.value.data?.[listKey] || [];
    const cached = readBrowserCache(cacheKey);
    if (result.value.data?.ok === false) return cached;
    if (list.length) {
      writeBrowserCache(cacheKey, list);
      return list;
    }
    if (cached.length) return cached;
    return list;
  }
  return readBrowserCache(cacheKey);
}

function readBrowserCache(key) {
  try {
    const raw = localStorage.getItem(key) || sessionStorage.getItem(key) || '[]';
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeBrowserCache(key, value) {
  const payload = JSON.stringify(Array.isArray(value) ? value : []);
  try {
    localStorage.setItem(key, payload);
  } catch {
    try {
      sessionStorage.setItem(key, payload);
    } catch {
      // Browser storage can be disabled; API data will still be used for this session.
    }
  }
}

function getLeadMergeKey(item) {
  return String(item?._id || item?.id || item?.sourceLeadId || item?.leadCode || item?.company || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function mergeLeadSources(crmLeads, ccpLeads) {
  const merged = [];
  const indexByKey = new Map();

  [...ccpLeads, ...crmLeads].forEach((item) => {
    const key = getLeadMergeKey(item);
    if (key && indexByKey.has(key)) {
      const index = indexByKey.get(key);
      merged[index] = { ...merged[index], ...item };
      return;
    }

    if (key) indexByKey.set(key, merged.length);
    merged.push(item);
  });

  return merged;
}

function formatExcelValue(value, field) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'number' && /date/i.test(field)) return XLSX.SSF.format('yyyy-mm-dd', value);
  return typeof value === 'string' ? value.trim() : value;
}

function formatDateInputValue(value) {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const raw = String(value).trim();
  if (!raw) return '';
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  const slashMatch = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (slashMatch) {
    const [, day, month, year] = slashMatch;
    const fullYear = year.length === 2 ? `20${year}` : year;
    return `${fullYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  return raw;
}

function splitCityPin(value) {
  const raw = String(value || '').trim();
  const pinMatch = raw.match(/\b\d{5,6}\b/);
  return {
    city: raw.replace(/\b\d{5,6}\b/g, '').replace(/[,\-]+$/g, '').trim(),
    pin: pinMatch ? pinMatch[0] : ''
  };
}

function normalizeVisibility(value) {
  const raw = String(value || '').trim().toUpperCase();
  if (raw === 'LIVE') return 'LIVE';
  if (raw === 'SUSPENDED') return 'SUSPENDED';
  return 'LIVE';
}

function normalizePersonName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function getVisibilityStatus(item) {
  const data = readClientData(item);
  return normalizeVisibility(item?.adminControls?.visibilityStatus || data.importMeta?.visibilityStatus || 'LIVE');
}

function resolvePersonName(value, people = []) {
  if (value && typeof value === 'object') {
    const directName = value.name || value.fullName || value.displayName || value.email;
    if (directName) return directName;
    return resolvePersonName(value._id || value.id || value.userId || value.crmUserId, people);
  }
  const raw = String(value || '').trim();
  if (!raw) return '';
  const normalized = raw.toLowerCase();
  const person = people.find((user) => [
    user?._id,
    user?.id,
    user?.userId,
    user?.crmUserId,
    user?.email
  ].some((candidate) => String(candidate || '').trim().toLowerCase() === normalized));
  if (person) return person.name || person.fullName || person.displayName || person.email || '';
  // Never leak database/user identifiers into a display-name column. Older
  // imports may contain an ObjectId/CRM user id without a populated user.
  if (/^[a-f\d]{16,}$/i.test(raw) || /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(raw)) return '';
  return raw;
}

function getAssignedName(item, people = []) {
  const operational = getAssignedStaffNames(item, people);
  if (operational.length) return operational.join(', ');
  const assigned = item?.adminControls?.assignedTo;
  const data = readClientData(item);
  const selectedLeadAssigned = item?.selectedLead?.assignedTo;
  const candidates = [
    assigned,
    data.importMeta?.assignedToName,
    data.importMeta?.assignedTo,
    item?.assignedToName,
    item?.assignedToText,
    item?.selectedLead?.assignedToName,
    item?.selectedLead?.assignedToText,
    selectedLeadAssigned,
    data.importMeta?.createdBy
  ];
  for (const candidate of candidates) {
    const name = resolvePersonName(candidate, people);
    if (name) return name;
  }
  return 'Not assigned';
}

function getAssignedStaffNames(item, people = []) {
  const data = readClientData(item);
  const lead = item?.selectedLead && typeof item.selectedLead === 'object' ? item.selectedLead : data.selectedLeadSnapshot || {};
  const serviceId = String(item?.assignedServiceId || data.assignedServiceId || data.selectedLeadSnapshot?.assignedServiceId || '');
  const services = lead.serviceSelections || [];
  const allAssignments = [...(Array.isArray(item?.assignments) ? item.assignments : []), ...(Array.isArray(lead.assignments) ? lead.assignments : [])];
  let assignments = serviceId ? allAssignments.filter(row => String(row.assignedServiceId || row.serviceAssignmentId || '') === serviceId) : allAssignments;
  if (serviceId && !assignments.length) {
    const index = services.findIndex(row => String(row.assignedServiceId || row.serviceAssignmentId || '') === serviceId);
    const row = (lead.assignments || [])[index];
    if (row && !row.assignedServiceId && !row.serviceAssignmentId) assignments = [row];
  }
  const scopedStaff = [...new Set(assignments.flatMap(row => [row.assignedStaff, row.assignedStaffText, row.assignedStaffEmail]).map(value => resolvePersonName(value, people)).filter(Boolean))];
  if (scopedStaff.length) {
    const normalized = new Map();
    for (const name of scopedStaff) normalized.set(name.toLowerCase(), name);
    return [...normalized.values()];
  }
  const serviceAllocations = Object.entries(item?.serviceAllocations || data.serviceAllocations || {}).filter(([key]) => !serviceId || key === serviceId).map(([,value]) => value);
  const candidates = [
    item?.assignedStaff,
    item?.assignedStaffText,
    item?.assignedStaffEmail,
    ...(services.length <= 1 ? [lead.assignedStaff, lead.assignedStaffText, lead.assignedStaffEmail] : []),
    ...assignments.flatMap((row) => [row?.assignedStaff, row?.assignedStaffText, row?.assignedStaffEmail]),
    ...serviceAllocations.map((entry) => {
      if (!entry) return '';
      const assignee = typeof entry === 'object'
        ? (entry.userId || entry.userIdString || entry.user || entry.assignedTo || entry.assigneeId || entry.assignedUserId || entry._id || entry.id)
        : entry;
      return resolvePersonName(assignee, people)
        || (typeof entry === 'object' ? String(entry.userName || entry.assignedUserName || entry.assigneeName || '').trim() : '');
    })
  ];
  return [...new Set(candidates.map((value) => resolvePersonName(value, people)).filter(Boolean))];
}

function getCpcbStatus(data = {}) {
  return data.cpcb?.status
    || data.cpcb?.approvalStatus
    || data.cpcb?.applicationStatus
    || data.cpcb?.processingStatus
    || 'Not provided';
}

function getOtpMobile(data = {}) {
  return data.otp?.mobile || data.authorised?.mobile || data.coordinating?.mobile || 'Not provided';
}

function getOtpName(data = {}) {
  return data.otp?.personName || data.authorised?.name || data.coordinating?.name || 'Not provided';
}

function enrichClientsFromLeads(clients = [], leads = []) {
  const normalizedLeads = mergeLeadSources([], leads);
  const byStableId = new Map();
  const byCompany = new Map();

  normalizedLeads.forEach((lead) => {
    [lead.leadNumber, lead.leadCode, lead.businessLeadCode, lead.sourceLeadId, lead._id, lead.id]
      .map((value) => normalizeClientIdentity(value))
      .filter(Boolean)
      .forEach((key) => byStableId.set(key, lead));
    const companyKey = normalizeClientIdentity(lead.company || lead.companyName);
    if (companyKey && !byCompany.has(companyKey)) byCompany.set(companyKey, lead);
  });

  return clients.map((client) => {
    const data = readClientData(client);
    const selectedLead = client?.selectedLead;
    const stableCandidates = [
      data.importMeta?.leadNumber,
      typeof selectedLead === 'object' ? selectedLead?.leadNumber || selectedLead?.leadCode || selectedLead?._id || selectedLead?.id : selectedLead
    ].map((value) => normalizeClientIdentity(value)).filter(Boolean);
    const companyCandidates = [data.basic?.clientLegalName, data.basic?.tradeName]
      .map((value) => normalizeClientIdentity(value)).filter(Boolean);
    const lead = stableCandidates.map((key) => byStableId.get(key)).find(Boolean)
      || companyCandidates.map((key) => byCompany.get(key)).find(Boolean);
    if (!lead) return client;

    const assigned = lead.assignedToText
      || lead.assignedTo?.name
      || (typeof lead.assignedTo === 'string' ? lead.assignedTo : '')
      || lead.assignedBy
      || lead.importedCreatedBy;
    const enrichedData = mergeClientData({
      otp: {
        ...(data.otp || {}),
        mobile: data.otp?.mobile || lead.mobileNo1 || lead.mobile || lead.phone || '',
        personName: data.otp?.personName || lead.contactPerson || lead.contactName || ''
      },
      authorised: {
        ...(data.authorised || {}),
        mobile: data.authorised?.mobile || lead.mobileNo1 || lead.mobile || lead.phone || '',
        name: data.authorised?.name || lead.contactPerson || lead.contactName || '',
        email: data.authorised?.email || lead.emails || lead.email || ''
      },
      importMeta: { ...(data.importMeta || {}), assignedTo: data.importMeta?.assignedTo || assigned || '' }
    }, data);
    return { ...client, data: enrichedData };
  });
}

function getAssignedId(item) {
  const assigned = item?.adminControls?.assignedTo;
  return assigned?._id || assigned?.id || (typeof assigned === 'string' ? assigned : '');
}

function getMsmeRows(data) {
  const rows = Array.isArray(data?.msmeRows) ? data.msmeRows.filter(Boolean) : [];
  if (rows.length) return rows;

  const compliance = data?.compliance || {};
  const fallbackRow = {
    classificationYear: compliance.msmeClassificationYear || compliance.classificationYear || '',
    status: compliance.msmeStatus || compliance.status || '',
    majorActivity: compliance.msmeMajorActivity || compliance.majorActivity || '',
    udyamNumber: compliance.msmeUdyamNumber || compliance.udyamNumber || '',
    turnover: compliance.msmeTurnover || compliance.turnover || '',
    value: compliance.msme || ''
  };
  return Object.values(fallbackRow).some(Boolean) ? [fallbackRow] : [];
}

function getMsmeSummary(data) {
  const rows = getMsmeRows(data);
  if (!rows.length) return 'N/A';
  const first = rows[0];
  return first.status || first.udyamNumber || first.value || first.label || 'Available';
}

function getClientUniqueId(item) {
  const data = readClientData(item);
  const value = data.importMeta?.uniqueId || item?.selectedLead?.leadCode || data.importMeta?.leadNumber || '-';
  // Client Master has its own compact client-code presentation. Old and new
  // lead code formats both resolve to the same client code without altering
  // the linked Lead document or any quotation/PO references.
  const match = String(value || '').trim().match(/^ATPL(?:-LEAD)?-(\d+)$/i);
  return match ? `ATPL-${match[1].padStart(4, '0')}` : value;
}

function normalizeQuotationToken(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeQuotationCompany(value) {
  return normalizeClientIdentity(value);
}

function getClientQuotationContext(client) {
  const data = readClientData(client);
  const lead = client?.selectedLead && typeof client.selectedLead === 'object' ? client.selectedLead : {};
  const clientName = data.basic?.clientLegalName || data.basic?.tradeName || '';
  const clientId = client?._id || client?.id || '';
  const clientUniqueId = data.importMeta?.uniqueId || getClientUniqueId(client);
  const serviceSelections = Array.isArray(lead.serviceSelections) && lead.serviceSelections.length ? lead.serviceSelections : null;
  const quotationItems = Array.isArray(data.quotationItems) && data.quotationItems.length ? data.quotationItems : null;
  return {
    sourceType: 'client',
    clientId,
    clientUniqueId,
    leadId: clientId,
    leadCode: clientUniqueId,
    linkedLeadId: typeof client?.selectedLead === 'string' ? client.selectedLead : lead?._id || lead?.id || '',
    linkedLeadCode: lead?.leadCode || data.importMeta?.leadNumber || '',
    annualYear: '',
    clientName,
    contactPerson: data.otp?.personName || data.authorised?.name || '',
    designation: data.otp?.designation || data.authorised?.designation || '',
    mobileNo1: data.otp?.mobile || data.authorised?.mobile || '',
    mobileNo2: data.authorised?.alternateMobile || '',
    addressLine1: data.registeredAddress?.address1 || '',
    addressLine2: data.registeredAddress?.address2 || '',
    addressLine3: data.registeredAddress?.address3 || '',
    state: data.registeredAddress?.state || '',
    city: data.registeredAddress?.city || '',
    pinCode: data.registeredAddress?.pincode || '',
    gstNumber: data.compliance?.gst || data.compliance?.gstNumber || data.basic?.gstNumber || '',
    industryType: data.companyOverview?.category || data.selectedLeadSnapshot?.industryType || lead?.industryType || '',
    servicesOffered: data.basic?.servicesOffered || data.selectedLeadSnapshot?.servicesOffered || lead?.servicesOffered || '',
    piboCategory: data.basic?.piboCategory || '',
    eprCategory: data.basic?.eprCategory || '',
    businessCategory: data.basic?.businessCategory || data.selectedLeadSnapshot?.businessCategory || lead?.businessCategory || '',
    serviceSelections,
    quotationItems,
    returnTo: `/sales/client-master/${encodeURIComponent(client?._id || client?.id || getClientUniqueId(client))}`
  };
}

function quotationMatchesClient(row, client) {
  if (!row || !client) return false;
  const data = readClientData(client);
  const lead = typeof client?.selectedLead === 'object' ? client.selectedLead : {};
  const details = row.leadDetails || {};
  const rowValues = [
    row.clientId,
    row.leadId,
    row.leadCode,
    details.leadCode
  ].map(normalizeQuotationToken).filter(Boolean);
  const clientValues = [
    client?._id,
    client?.id,
    typeof client?.selectedLead === 'string' ? client.selectedLead : '',
    lead?._id,
    lead?.id,
    lead?.leadCode,
    data.importMeta?.leadNumber,
    data.importMeta?.uniqueId,
    getClientUniqueId(client)
  ].map(normalizeQuotationToken).filter(Boolean);

  if (rowValues.some((value) => clientValues.includes(value))) return true;

  const rowCompany = normalizeQuotationCompany(details.companyName || row.companyName);
  const companyValues = [
    data.basic?.clientLegalName,
    data.basic?.tradeName,
    lead?.company
  ].map(normalizeQuotationCompany).filter(Boolean);

  return Boolean(rowCompany && companyValues.includes(rowCompany));
}

function getClientQuotations(quotations, client) {
  return (quotations || [])
    .filter((row) => quotationMatchesClient(row, client))
    .sort((a, b) => new Date(b.createdAt || b.updatedAt || 0) - new Date(a.createdAt || a.updatedAt || 0));
}

function getAnnualReturnFilingYears(annualReturn = {}) {
  const filings = annualReturn?.filings && typeof annualReturn.filings === 'object' && !Array.isArray(annualReturn.filings)
    ? Object.keys(annualReturn.filings)
    : [];
  return filings
    .map(normalizeFinancialYearLabel)
    .filter(Boolean)
    .sort((left, right) => (parseFinancialYearStart(left) || 0) - (parseFinancialYearStart(right) || 0));
}

function getFirstAnnualReturnYear(item, data = readClientData(item)) {
  const annualReturn = data.annualReturn && typeof data.annualReturn === 'object' && !Array.isArray(data.annualReturn)
    ? data.annualReturn
    : {};
  const savedFilingYears = getAnnualReturnFilingYears(annualReturn);
  const candidates = [
    data.basic?.firstAnnualReturnYear,
    data.basic?.annualReturnYear,
    data.basic?.firstAnnualYear,
    data.firstAnnualReturnYear,
    data.annualReturnYear,
    annualReturn.firstAnnualReturnYear,
    annualReturn.firstAnnualYear,
    annualReturn.annualReturnYear,
    annualReturn.selectedYear,
    annualReturn.lastSavedYear,
    savedFilingYears[0],
    item?.firstAnnualReturnYear,
    item?.annualReturnYear,
    item?.annualYear,
    item?.returnYear
  ];
  const match = candidates.find((value) => normalizeFinancialYearLabel(value));
  return match ? normalizeFinancialYearLabel(match) : '';
}

function parseFinancialYearStart(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/\b(20\d{2})\b/);
  return match ? Number(match[1]) : null;
}

function formatFinancialYear(startYear) {
  return `${startYear}-${String(startYear + 1).slice(-2)}`;
}

function normalizeFinancialYearLabel(value) {
  const startYear = parseFinancialYearStart(value);
  return startYear ? formatFinancialYear(startYear) : '';
}

function getLatestCompletedFinancialYearStart(date = new Date()) {
  const currentFinancialYearStart = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
  return currentFinancialYearStart - 1;
}

function buildAnnualReturnYearOptions() {
  const latestStart = getLatestCompletedFinancialYearStart();
  const earliestStart = latestStart - 11;
  const latestSelectableStart = Math.max(2029, latestStart);
  return Array.from(
    { length: latestSelectableStart - earliestStart + 1 },
    (_, index) => formatFinancialYear(latestSelectableStart - index)
  );
}

function buildAnnualReturnYears(firstAnnualReturnYear) {
  const requestedStart = parseFinancialYearStart(firstAnnualReturnYear);
  if (!requestedStart) return [];

  const latestStart = getLatestCompletedFinancialYearStart();
  if (requestedStart > latestStart) return [];

  const years = [];

  for (let year = requestedStart; year <= latestStart; year += 1) {
    years.push({
      startYear: year,
      label: formatFinancialYear(year),
      period: 'April - March',
      status: year === latestStart ? 'Current hub' : 'Open hub'
    });
  }

  return years;
}

function matchesAssignedStaff(item, staff, staffFilter) {
  if (!staffFilter) return true;
  const selectedStaff = staff.find((user) => [user?._id, user?.id, user?.crmUserId, user?.userId].some((value) => String(value || '') === String(staffFilter)));
  const targetTokens = String(staffFilter).startsWith('name:')
    ? [String(staffFilter).slice(5)]
    : [staffFilter, selectedStaff?._id, selectedStaff?.id, selectedStaff?.crmUserId, selectedStaff?.userId, selectedStaff?.name, selectedStaff?.email];
  const assignments = [...(Array.isArray(item?.assignments) ? item.assignments : []), ...(Array.isArray(item?.selectedLead?.assignments) ? item.selectedLead.assignments : [])];
  const candidates = [
    getAssignedId(item), getAssignedName(item, staff), item?.createdBy, item?.createdBy?.name, item?.createdBy?.email,
    readClientData(item).importMeta?.createdBy, item?.selectedLead?.createdBy, item?.selectedLead?.createdByName,
    item?.selectedLead?.createdByEmail, item?.selectedLead?.importedCreatedBy,
    ...getAssignedStaffNames(item, staff),
    ...assignments.flatMap((row) => [row?.assignedStaff, row?.assignedStaffText, row?.assignedStaffEmail])
  ];
  const normalizedTargets = targetTokens.map(normalizePersonName).filter(Boolean);
  return candidates.some((candidate) => {
    if (candidate && typeof candidate === 'object') return [candidate._id, candidate.id, candidate.crmUserId, candidate.userId, candidate.name, candidate.email].some((value) => normalizedTargets.includes(normalizePersonName(value)));
    return normalizedTargets.includes(normalizePersonName(candidate));
  });
}

function normalizeApproval(value) {
  const raw = String(value || '').trim().toUpperCase();
  if (raw === 'APPROVED') return 'APPROVED';
  if (raw === 'REJECTED') return 'REJECTED';
  return 'PENDING';
}

function mapExcelRowToClient(row, staff, leads) {
  const mapping = {
    uniqueid: 'importMeta.uniqueId',
    tradename: 'basic.tradeName',
    leadnote: 'importMeta.leadNote',
    leadnumber: 'importMeta.leadNumber',
    clientstatus: 'importMeta.clientStatus',
    visibilitystatus: 'adminControls.visibilityStatus',
    createdby: 'importMeta.createdBy',
    creationdate: 'importMeta.creationDate',
    assignedto: 'importMeta.assignedTo',
    clientname: 'basic.clientLegalName',
    companytype: 'basic.companyType',
    companyconstitution: 'basic.companyType',
    entitytype: 'basic.companyType',
    clientonboardingyear: 'basic.onboardingYear',
    firstannualreturnyearapplicable: 'basic.firstAnnualReturnYear',
    firstannualreturnyear: 'basic.firstAnnualReturnYear',
    annualreturnyear: 'basic.firstAnnualReturnYear',
    state: 'registeredAddress.state',
    citywithpin: 'cityWithPin',
    contactperson: 'otp.personName',
    email: 'authorised.email',
    companyindustry: 'basic.companyIndustry',
    pibocategory: 'basic.piboCategory',
    servicesoffered: 'basic.servicesOffered',
    contactno: 'otp.mobile',
    website: 'basic.website',
    gstnumber: 'compliance.gst',
    gstcertificatedate: 'compliance.gstDate',
    cin: 'compliance.cin',
    cindocumentdate: 'compliance.cinDate',
    pan: 'compliance.pan',
    pandocumentdate: 'compliance.panDate',
    factorylicenseno: 'compliance.factoryLicense',
    factorylicensedocumentdate: 'compliance.factoryLicenseDate',
    msmeclassificationyear: 'msmeRows.0.classificationYear',
    msmeclassificationyearrequired: 'msmeRows.0.classificationYear',
    msmestatus: 'msmeRows.0.status',
    msmestatusrequired: 'msmeRows.0.status',
    msmemajoractivity: 'msmeRows.0.majorActivity',
    msmemajoractivityrequired: 'msmeRows.0.majorActivity',
    msmeudyamnumber: 'msmeRows.0.udyamNumber',
    msmeudyamnumberrequired: 'msmeRows.0.udyamNumber',
    turnoverofthecompanycr: 'msmeRows.0.turnover',
    turnoverofthecompanycrrequired: 'msmeRows.0.turnover',
    msmeudyamcertificate: 'msmeRows.0.file',
    msme1: 'msmeRows.0.value',
    msme2: 'msmeRows.1.value',
    msme3: 'msmeRows.2.value',
    msme4: 'msmeRows.3.value',
    msme5: 'msmeRows.4.value',
    cpcbregno: 'cpcb.registrationNumber',
    cpcbstatus: 'cpcb.status',
    cepruserid: 'cpcb.ceprUserId',
    ceprpassword: 'cpcb.ceprPassword',
    cpcblogin: 'cpcb.loginId',
    cpcbpassword: 'cpcb.loginPassword',
    eprcategory: 'basic.eprCategory',
    eprcertificateno: 'compliance.eprCertificate',
    approvalstatus: 'adminControls.approvalStatus',
    approvedby: 'importMeta.approvedBy',
    otpmobile: 'otp.mobile',
    otpname: 'otp.personName',
    regaddressline1: 'registeredAddress.address1',
    regaddressline2: 'registeredAddress.address2',
    regaddressline3: 'registeredAddress.address3',
    regcity: 'registeredAddress.city',
    regstate: 'registeredAddress.state',
    regpin: 'registeredAddress.pincode',
    commaddressline1: 'communicationAddress.address1',
    commaddressline2: 'communicationAddress.address2',
    commaddressline3: 'communicationAddress.address3',
    commcity: 'communicationAddress.city',
    commstate: 'communicationAddress.state',
    commpin: 'communicationAddress.pincode',
    documenturlsmax5: 'validation.documentUrls',
    authpersonname: 'authorised.name',
    authpersondesignation: 'authorised.designation',
    authpersonmobile: 'authorised.mobile',
    authpersonemail: 'authorised.email',
    coordpersonname: 'coordinating.name',
    coordpersondesignation: 'coordinating.designation',
    coordpersonmobile: 'coordinating.mobile',
    coordpersonemail: 'coordinating.email',
    applicationisforrenewal: 'annualReturn.applicationRenewal',
    applicationisforrenewalproducer: 'annualReturn.applicationRenewal',
    applicationisforrenewalproduceryesno: 'annualReturn.applicationRenewal',
    registrationno: 'cpcb.registrationNumber',
    registrationnumber: 'cpcb.registrationNumber',
    registrationnouserwillenter: 'cpcb.registrationNumber',
    dateofissue: 'cpcb.issueDate',
    dateofissueuserwillenter: 'cpcb.issueDate',
    validityofregistration: 'cpcb.validityDate',
    validityofregistrationcertificate: 'cpcb.validityDate',
    validityofregistrationcertificateuploadeddocument: 'cpcb.validityDate',
    producerregistrationcapacity: 'cpcb.registrationCapacity',
    producerregistrationcapacityuserinput: 'cpcb.registrationCapacity',
    registeredwithdistrictindustriescentre: 'annualReturn.districtIndustryCentreRegistered',
    ifregisteredwithdistrictindustriescentre: 'annualReturn.districtIndustryCentreRegistered',
    ifregisteredwithdistrictindustriescentreuserinputdocument: 'annualReturn.districtIndustryCentreRegistered',
    totalcapitalinvestedintheprojectconcerned: 'financials.totalCapitalInvested',
    totalcapitalinvestedintheprojectconcerneduserwillenter: 'financials.totalCapitalInvested',
    yearofcommencementofoperation: 'annualReturn.commencementYear',
    yearofcommencementofoperationuserwillenter: 'annualReturn.commencementYear',
    productpackagingmajorusedimage: 'annualReturn.productPackagingMajorMaterial',
    productpackagingmajoruploadedimage: 'annualReturn.productPackagingMajorMaterial',
    processflowdiagram: 'annualReturn.processFlowDiagram',
    processflowdiagramuploaddocument: 'annualReturn.processFlowDiagram',
    thicknessofplastic: 'annualReturn.thicknessOfPlastic',
    thicknessofplasticuserinput: 'annualReturn.thicknessOfPlastic'
  };

  const payload = {
    selectedLead: '',
    adminControls: { approvalStatus: 'PENDING', visibilityStatus: 'LIVE', assignedTo: '' },
    data: {
      basic: {},
      registeredAddress: {},
      communicationAddress: {},
      compliance: {},
      msmeRows: [],
      cte: { numberOfPlantsLocations: '', plantWiseDetails: [] },
      cpcb: {},
      validation: {},
      otp: {},
      authorised: {},
      coordinating: {},
      importMeta: {}
    },
    workflowStatus: 'draft'
  };

  function setPath(path, value) {
    if (!path) return;
    if (path === 'cityWithPin') {
      const parsed = splitCityPin(value);
      if (parsed.city && !payload.data.registeredAddress.city) payload.data.registeredAddress.city = parsed.city;
      if (parsed.pin && !payload.data.registeredAddress.pincode) payload.data.registeredAddress.pincode = parsed.pin;
      return;
    }
    if (path === 'adminControls.visibilityStatus') {
      payload.adminControls.visibilityStatus = normalizeVisibility(value);
      return;
    }
    if (path === 'adminControls.approvalStatus') {
      payload.adminControls.approvalStatus = normalizeApproval(value);
      return;
    }
    if (path === 'validation.documentUrls') {
      payload.data.validation.documentUrls = String(value || '').split(/[,;\n]+/).map((item) => item.trim()).filter(Boolean).slice(0, 5);
      return;
    }
    if (path.startsWith('msmeRows.')) {
      const [, indexText, field = 'value'] = path.split('.');
      const index = Number(indexText);
      if (value) payload.data.msmeRows[index] = { ...(payload.data.msmeRows[index] || { label: `MSME ${index + 1}` }), [field]: value };
      return;
    }

    const target = path.startsWith('adminControls.') ? payload.adminControls : payload.data;
    const parts = path.replace(/^adminControls\./, '').split('.');
    let cursor = target;
    parts.slice(0, -1).forEach((part) => {
      cursor[part] = cursor[part] || {};
      cursor = cursor[part];
    });
    cursor[parts[parts.length - 1]] = value;
  }

  Object.entries(row || {}).forEach(([key, value]) => {
    const field = mapping[normalizeHeaderKey(key)];
    if (!field) return;
    const clean = formatExcelValue(value, field);
    if (clean === '') return;
    setPath(field, clean);
  });

  if (!payload.data.basic.clientLegalName) payload.data.basic.clientLegalName = payload.data.basic.tradeName || payload.data.importMeta.uniqueId || '';
  if (!payload.data.communicationAddress.address1) payload.data.communicationAddress.address1 = payload.data.registeredAddress.address1 || '';
  if (!payload.data.communicationAddress.city) payload.data.communicationAddress.city = payload.data.registeredAddress.city || '';
  if (!payload.data.communicationAddress.state) payload.data.communicationAddress.state = payload.data.registeredAddress.state || '';
  if (!payload.data.communicationAddress.pincode) payload.data.communicationAddress.pincode = payload.data.registeredAddress.pincode || '';
  if (!payload.data.authorised.name) payload.data.authorised.name = payload.data.otp.personName || '';
  if (!payload.data.authorised.mobile) payload.data.authorised.mobile = payload.data.otp.mobile || '';

  const assignedRaw = payload.data.importMeta.assignedTo || '';
  const assignedMatch = staff.find((user) => normalizePersonName(user.name) === normalizePersonName(assignedRaw));
  if (assignedMatch) payload.adminControls.assignedTo = assignedMatch._id || assignedMatch.id;

  const leadRaw = payload.data.importMeta.leadNumber || payload.data.importMeta.uniqueId || '';
  const leadMatch = leads.find((leadItem) => String(leadItem.leadCode || '').toLowerCase() === String(leadRaw).toLowerCase());
  if (leadMatch) payload.selectedLead = leadMatch._id || leadMatch.id;

  return payload;
}


export {
  annualDraftLegacyKeys,
  getAnnualDraftAliasValue,
  normalizeHeaderKey,
  isFilled,
  buildValueLookup,
  pickLookup,
  mapFlatClientData,
  mergeClientData,
  readClientData,
  normalizeClientIdentity,
  hasMeaningfulIdentity,
  getClientAliases,
  getClientSourceKey,
  findClientByRouteKey,
  getClientCompletenessScore,
  mergeClientItems,
  mergeClientSources,
  readCachedOrFreshList,
  readBrowserCache,
  writeBrowserCache,
  getLeadMergeKey,
  mergeLeadSources,
  formatExcelValue,
  formatDateInputValue,
  splitCityPin,
  normalizeVisibility,
  normalizePersonName,
  getVisibilityStatus,
  getAssignedName,
  getAssignedStaffNames,
  getCpcbStatus,
  getOtpMobile,
  getOtpName,
  enrichClientsFromLeads,
  getAssignedId,
  getMsmeRows,
  getMsmeSummary,
  getClientUniqueId,
  normalizeQuotationToken,
  normalizeQuotationCompany,
  getClientQuotationContext,
  quotationMatchesClient,
  getClientQuotations,
  getFirstAnnualReturnYear,
  parseFinancialYearStart,
  formatFinancialYear,
  normalizeFinancialYearLabel,
  getLatestCompletedFinancialYearStart,
  buildAnnualReturnYearOptions,
  buildAnnualReturnYears,
  matchesAssignedStaff,
  normalizeApproval,
  mapExcelRowToClient
};

