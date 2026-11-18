export const SHARED_EPR_CREDIT_PO_FIELDS = [
  'poNumber',
  'poDate',
  'poEndDate',
  'poFinancialYear',
  'annualReturnYear',
  'registrationYear',
  'paymentTerm',
  'poFileUrl',
  'poFileName',
  'poFileMimeType',
  'poFileSize',
  'currency',
  'poReceivedDate'
];

export function updateEprCreditPoRows(rows = [], rowIndex, patch = {}) {
  const sharedPatch = Object.fromEntries(
    Object.entries(patch).filter(([field]) => SHARED_EPR_CREDIT_PO_FIELDS.includes(field))
  );

  return rows.map((row, index) => ({
    ...row,
    ...(index === rowIndex ? patch : sharedPatch)
  }));
}

export function selectEprCreditPoService(dialog = {}, rowIndex, assignedServiceId) {
  const service = (dialog.eprCreditServiceOptions || []).find(
    (item) => String(item.assignedServiceId || '') === String(assignedServiceId || '')
  );
  if (!service) return dialog;

  const quotationRow = (dialog.crmPoYearRows || []).find(
    (row) => String(row.assignedServiceId || '') === String(assignedServiceId || '')
  );
  const patch = {
    assignedServiceId: service.assignedServiceId,
    fy: service.firstAnnualReturnYearApplicable || service.servicesForYear || service.financialYear || '',
    services: [service.servicesOffered || service.applicableService].filter(Boolean)
  };

  if (dialog.quotationSent === 'yes' && quotationRow) {
    Object.assign(patch, {
      quotationItemIndex: quotationRow.quotationItemIndex,
      quotationId: quotationRow.quotationId,
      quotationNumber: quotationRow.quotationNumber,
      quotationItems: quotationRow.quotationItems,
      quotationBasicAmount: quotationRow.quotationBasicAmount,
      quotationCreatedById: quotationRow.quotationCreatedById,
      quotationCreatedByEmail: quotationRow.quotationCreatedByEmail
    });
  }

  return {
    ...dialog,
    poYearRows: updateEprCreditPoRows(dialog.poYearRows, rowIndex, patch)
  };
}

export function groupEprCreditPoRowsByService(rows = [], services = []) {
  const servicesById = new Map(services.map((service) => [String(service.assignedServiceId || ''), service]));
  const rowsByServiceId = new Map();

  for (const row of rows) {
    const assignedServiceId = String(row.assignedServiceId || '');
    if (!servicesById.has(assignedServiceId)) {
      return { error: 'Choose a valid EPR Credit service for every PO row.', groups: [] };
    }
    if (rowsByServiceId.has(assignedServiceId)) {
      return { error: 'Select each EPR Credit service only once.', groups: [] };
    }
    rowsByServiceId.set(assignedServiceId, [row]);
  }

  if (services.some((service) => !rowsByServiceId.has(String(service.assignedServiceId || '')))) {
    return { error: 'Add a PO entry for every selected EPR Credit service.', groups: [] };
  }

  return {
    error: '',
    groups: services.map((service) => ({
      service,
      rows: rowsByServiceId.get(String(service.assignedServiceId || ''))
    }))
  };
}
