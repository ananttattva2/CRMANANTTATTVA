const text = (value) => String(value ?? '').trim();
const normalized = (value) => text(value).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '');

function quotationTime(quotation = {}) {
  const value = quotation.updatedAt || quotation.createdAt || quotation.quotationDate || 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function serviceIdentity(source = {}) {
  const first = (...fields) => fields.map((field) => normalized(source?.[field])).find(Boolean) || '';
  return {
    applicant: first('subApplicantType', 'piboCategory', 'applicantType', 'piboParent', 'piboCategoryParent'),
    category: first('eprCategory', 'serviceCategory'),
    offering: first('servicesOffered', 'applicableService'),
    business: first('businessCategory'),
    year: first('servicesForYear', 'financialYear', 'firstAnnualReturnYearApplicable')
  };
}

function compatibleItem(item = {}, service = {}) {
  const target = serviceIdentity(service);
  const candidate = serviceIdentity(item);
  const comparable = Object.keys(target).filter((key) => target[key] && candidate[key]);
  if (!comparable.length || comparable.some((key) => target[key] !== candidate[key])) return false;
  if (target.applicant && candidate.applicant && target.applicant !== candidate.applicant) return false;
  return comparable.length >= 2 || Boolean(target.applicant && target.applicant === candidate.applicant);
}

function amountForQuotation(quotation = {}, items = []) {
  if (quotation.pricingMode === 'combined') {
    return Number(quotation.combinedBasicAmount) || Number(quotation.subtotal) || Number(quotation.grandTotal) || 0;
  }
  const itemTotal = items.reduce((sum, item) => sum + (Number(item.unit) || 1) * (Number(item.basicAmount) || 0), 0);
  return itemTotal || Number(quotation.subtotal) || Number(quotation.grandTotal) || Number(quotation.combinedBasicAmount) || 0;
}

function selectLatestPoQuotation(quotations = [], row = {}, payload = {}) {
  const ordered = [...quotations].sort((left, right) => quotationTime(right) - quotationTime(left));
  const serviceIds = new Set([
    payload.assignedServiceId, payload.service?.assignedServiceId, row.assignedServiceId,
    ...(Array.isArray(row.quotationItems) ? row.quotationItems.map((item) => item?.assignedServiceId) : [])
  ].map(text).filter(Boolean));

  if (serviceIds.size) {
    for (const quotation of ordered) {
      const items = (quotation.items || []).filter((item) => serviceIds.has(text(item?.assignedServiceId)));
      if (items.length) return { quotation, items };
    }
  }

  const service = payload.service || (Array.isArray(row.quotationItems) ? row.quotationItems[0] : null) || row;
  for (const quotation of ordered) {
    const items = (quotation.items || []).filter((item) => compatibleItem(item, service));
    if (items.length) return { quotation, items };
  }

  const quotationId = text(row.quotationId);
  const quotationNumber = text(row.quotationNumber || row.quotationNo).toLowerCase();
  const exact = ordered.find((quotation) => quotationId && text(quotation._id || quotation.id) === quotationId)
    || ordered.find((quotation) => quotationNumber && text(quotation.quotationNumber).toLowerCase() === quotationNumber);
  const quotation = exact || ordered[0] || null;
  return { quotation, items: quotation?.items || [] };
}

function enrichPoRowsWithLatestQuotation(rows = [], quotations = [], payload = {}) {
  return rows.map((row) => {
    const systemQuotation = text(row.quotationSent || payload.quotationSent).toLowerCase() === 'yes'
      || Boolean(row.quotationId || row.quotationNumber || row.quotationNo);
    if (!systemQuotation) return row;
    const { quotation, items } = selectLatestPoQuotation(quotations, row, payload);
    if (!quotation) return row;
    const amount = amountForQuotation(quotation, items);
    return {
      ...row,
      quotationSent: 'yes',
      quotationId: text(quotation._id || quotation.id) || row.quotationId || '',
      quotationNumber: text(quotation.quotationNumber) || row.quotationNumber || row.quotationNo || '',
      quotationItems: items,
      quotationBasicAmount: amount || null
    };
  });
}

module.exports = { quotationTime, amountForQuotation, selectLatestPoQuotation, enrichPoRowsWithLatestQuotation };
