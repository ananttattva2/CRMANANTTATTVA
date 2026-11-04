// Canonical quotation document used by CRM preview, email attachments and admin downloads.
import { normalizeDateInputValue, serviceEndDateFrom } from './servicePeriod.mjs';

const ANANT_LOGO_SOURCE_URL = '/ananttattva-logo.png';

const EPR_CREDIT_UOM_OPTIONS = ['KG', 'MT'];

const EPR_CREDIT_YEAR_OPTIONS = ['2022-23', '2023-24', '2024-25', '2025-26', '2026-27', '2027-28', '2028-29', '2029-30'];

function isEprCreditItem(item = {}) {
  return String(item.businessCategory || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '') === 'eprcredit';
}

function quotationUnitLabel(item = {}) {
  const unit = String(item.unit || '1').trim() || '1';
  const uom = String(item.unitLabel || '').trim().toUpperCase();
  return isEprCreditItem(item) && EPR_CREDIT_UOM_OPTIONS.includes(uom) ? `${unit}${uom}` : unit;
}

function isPlasticWasteService(item = {}) {
  return /(?:^|\b)plastic\s+waste(?:\b|$)/i.test(String(item.serviceCategory || item.eprCategory || ''));
}

function getQuotationApplicantType(item = {}, source = {}) {
  if (isPlasticWasteService({ ...item, serviceCategory: source.serviceCategory || source.eprCategory || item.serviceCategory || item.eprCategory })) {
    return String(source.subApplicantType || source.piboCategory || item.subApplicantType || item.piboCategory || source.applicantType || item.applicantType || '-').trim() || '-';
  }
  return String(source.applicantType || item.applicantType || item.piboCategory || item.piboParent || '-').trim() || '-';
}

function quotationEprCreditYears(item = {}) {
  return Array.isArray(item.annualReturnEprCreditYears)
    ? item.annualReturnEprCreditYears.filter((year) => EPR_CREDIT_YEAR_OPTIONS.includes(String(year)))
    : [];
}

function parseDateInputValue(value) {
  const normalized = normalizeDateInputValue(value);
  if (!normalized) return null;
  const [year, month, day] = normalized.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (
    Number.isNaN(date.getTime())
    || date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

function formatServiceDate(value) {
  const parts = parseDateInputValue(value);
  if (!parts) return '-';
  return new Date(parts.year, parts.month - 1, parts.day).toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata' }).replace(/\//g, '-');
}

function quotationServiceDateRange(item = {}) {
  const startDate = normalizeDateInputValue(item.serviceStartDate);
  if (!startDate) return '-';
  const savedEndDate = normalizeDateInputValue(item.serviceEndDate);
  const endDate = savedEndDate || serviceEndDateFrom(startDate, item.servicePeriod || 1, item.periodUnit || 'annual');
  return `${formatServiceDate(startDate)} - ${formatServiceDate(endDate)}`;
}

function quotationServiceDateRangeHtml(item = {}) {
  return escapeHtml(quotationServiceDateRange(item)).replace(' - ', '<br>to ');
}

function quotationAnnualReturnOrCreditYears(item = {}) {
  const years = isEprCreditItem(item)
    ? quotationEprCreditYears(item)
    : (Array.isArray(item.annualReturnYears) ? item.annualReturnYears : []);
  return [...new Set(years.map(String).filter(Boolean))];
}

function isAnnualReturnRegistrationApplicant(item = {}) {
  const applicantType = String(getQuotationApplicantType(item) || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
  return applicantType === 'producer' || applicantType === 'importerofrawmaterial';
}

function isPwpQuotationApplicant(item = {}) {
  return [
    getQuotationApplicantType(item),
    item.applicantType,
    item.piboParent,
    item.piboCategoryParent
  ].some((value) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '') === 'pwp');
}

function quotationServicePeriodYears(item = {}) {
  const start = parseDateInputValue(normalizeDateInputValue(item.serviceStartDate));
  if (!start) return [];
  const savedEnd = normalizeDateInputValue(item.serviceEndDate);
  const computedEnd = savedEnd || serviceEndDateFrom(item.serviceStartDate, item.servicePeriod || 1, item.periodUnit || 'annual');
  const end = parseDateInputValue(computedEnd) || start;
  const firstYear = start.month >= 4 ? start.year : start.year - 1;
  const lastYear = end.month >= 4 ? end.year : end.year - 1;
  return Array.from({ length: Math.max(1, lastYear - firstYear + 1) }, (_, index) => {
    const year = firstYear + index;
    return `${year}-${String(year + 1).slice(-2)}`;
  });
}

function quotationAnnualReturnRegistrationYear(item = {}) {
  if (isEprCreditItem(item)) return '';
  if (String(item.registrationYear || '').trim()) return String(item.registrationYear).trim();
  const selectedYears = quotationAnnualReturnOrCreditYears(item);
  const displayedYears = selectedYears.length ? selectedYears : quotationServicePeriodYears(item);
  if (isPwpQuotationApplicant(item)) return displayedYears.join(', ') || item.financialYear || '-';
  if (isEprConsultancyItem(item)) {
    return displayedYears.join(', ') || item.financialYear || '-';
  }
  if (!isAnnualReturnRegistrationApplicant(item)) return '-';
  return displayedYears.join(', ') || item.financialYear || '-';
}

function isEprConsultancyItem(item = {}) {
  return String(item.businessCategory || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '') === 'eprconsultancy';
}

function normalizedQuotationService(item = {}) {
  return String(item.servicesOffered || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function isAnnualReturnQuotationService(item = {}) {
  return normalizedQuotationService(item).includes('annualreturn');
}

function isRegistrationQuotationService(item = {}) {
  return normalizedQuotationService(item).includes('registration');
}

function quotationYearMappingHeader(items = []) {
  const consultancyItems = items.filter(isEprConsultancyItem);
  if (consultancyItems.length) {
    const hasAnnualReturn = consultancyItems.some(isAnnualReturnQuotationService);
    const hasRegistration = consultancyItems.some(isRegistrationQuotationService);
    if (hasAnnualReturn && !hasRegistration) return 'Annual Return Year';
    if (hasRegistration && !hasAnnualReturn) return 'Registration EPR Year';
    return 'EPR Year';
  }
  if (items.some((item) => String(item.registrationYear || '').trim())) return 'Registration EPR Year';
  return 'Annual Return EPR Year / Credit Year';
}

function isMeaningfulQuotationItem(item = {}) {
  return [
    item.industryType,
    item.serviceCategory,
    item.serviceStartDate,
    item.serviceEndDate,
    item.servicesForYear,
    item.eprCategory,
    item.businessCategory,
    item.piboCategory
  ].some((value) => String(value || '').trim())
    || Number(item.basicAmount) > 0;
}

const PAYMENT_TERM_OPTIONS = [
  '100% after completion of work',
  '50% advance and 50% after completion of work',
  '50% upon receipt of PO and 50% upon completion of EPR Annual Filing',
  '100% advance payment'
];

function quotationPaymentTerm(row = {}) {
  const terms = Array.isArray(row.terms) ? row.terms.map((term) => String(term ?? '').trim()).filter(Boolean) : [];
  const selected = String(row.paymentTerm || '').trim();
  if (selected && terms.includes(selected)) return selected;
  const legacySelections = terms.filter((term) => PAYMENT_TERM_OPTIONS.includes(term));
  return legacySelections.length === 1 ? legacySelections[0] : '';
}

function quotationSelectedTerms(row = {}) {
  const terms = Array.isArray(row.terms) ? row.terms.map((term) => String(term ?? '').trim()).filter(Boolean) : [];
  const selected = quotationPaymentTerm(row);
  return selected ? [selected] : terms;
}

const ANANT_TATTVA_GST_NUMBER = '27AAZCA6657R1ZB';

const ANANT_TATTVA_ADDRESS = '1st Floor, A/25, Technocraft House, Road No. 3, MIDC, Andheri East, Mumbai, Maharashtra 400093';

function quotationOwnerName(quotation = {}) {
  if (String(quotation.quotationNumber || '').trim().toUpperCase() === 'AT/26-27/325') return 'ANAND PADHYA';
  return String(
    quotation.fromName
    || quotation.leadGeneratedBy
    || quotation.assignedUserName
    || quotation.createdByName
    || quotation.createdBy?.name
    || quotation.createdBy?.email
    || '-'
  ).trim() || '-';
}

function quotationPreparedByName(quotation = {}) {
  if (String(quotation.quotationNumber || '').trim().toUpperCase() === 'AT/26-27/325') return 'SAURABH BHAT';
  return String(quotation.preparedByName || quotation.createdBy?.name || quotation.createdByName || quotation.preparedBy || '-').trim() || '-';
}

function isCombinedQuotation(quotation = {}) {
  return quotation.pricingMode === 'combined';
}

function quotationItemsTotal(items = []) {
  return items.reduce((sum, item) => sum + ((Number(item.unit) || 1) * (Number(item.basicAmount) || 0)), 0);
}

function quotationItemKey(item = {}, index = 0) {
  return String(item.assignedServiceId || item.id || (Number.isInteger(Number(item.sourceServiceIndex)) ? `source:${Number(item.sourceServiceIndex)}` : `item:${index}`)).trim();
}

function normalizeCombinedPricingGroups(quotation = {}, items = []) {
  const groups = Array.isArray(quotation.combinedPricingGroups) ? quotation.combinedPricingGroups : [];
  if (groups.length) {
    return groups.map((group, index) => ({
      id: String(group.id || `combined-group-${index + 1}`),
      name: String(group.name || `Combined Group ${index + 1}`),
      itemKeys: [...new Set((Array.isArray(group.itemKeys) ? group.itemKeys : []).map(String).filter(Boolean))],
      basicAmount: group.basicAmount ?? ''
    }));
  }
  if (quotation.pricingMode !== 'combined' || !items.length) return [];
  return [{
    id: 'legacy-combined-group',
    name: 'Combined Group 1',
    itemKeys: items.map(quotationItemKey),
    basicAmount: quotation.combinedBasicAmount ?? ''
  }];
}

function combinedPricingRows(quotation = {}, items = []) {
  const groups = normalizeCombinedPricingGroups(quotation, items);
  const groupByItemKey = new Map();
  groups.forEach((group) => {
    (group.itemKeys || []).forEach((key) => groupByItemKey.set(String(key), group));
  });
  const rows = items.map((item, index) => ({
    item,
    index,
    group: groupByItemKey.get(quotationItemKey(item, index)) || {
      id: `unassigned-${index}`,
      basicAmount: item.basicAmount ?? 0
    }
  }));
  // HTML rowSpan can only merge contiguous rows. Keep each saved pricing
  // group together so an interleaved service cannot repeat its group amount.
  const groupOrder = new Map(groups.map((group, index) => [group.id, index]));
  rows.sort((left, right) => (groupOrder.get(left.group.id) ?? groups.length)
    - (groupOrder.get(right.group.id) ?? groups.length) || left.index - right.index);
  rows.forEach((row, rowIndex) => {
    const previousGroupId = rows[rowIndex - 1]?.group?.id;
    row.firstInGroup = rowIndex === 0 || previousGroupId !== row.group.id;
    if (!row.firstInGroup) return;
    let runEnd = rowIndex + 1;
    while (runEnd < rows.length && rows[runEnd].group.id === row.group.id) runEnd += 1;
    row.groupSize = runEnd - rowIndex;
  });
  return rows;
}

function combinedQuotationTotal(quotation = {}, items = []) {
  const groups = normalizeCombinedPricingGroups(quotation, items);
  if (groups.length) return groups.reduce((sum, group) => sum + (Number(group.basicAmount) || 0), 0);
  const itemTotal = quotationItemsTotal(items);
  return itemTotal || Number(quotation.combinedBasicAmount) || Number(quotation.grandTotal) || 0;
}

function formatInr(value) {
  return (Number(value) || 0).toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function meaningfulQuotationItems(items) {
  if (!Array.isArray(items)) return [];
  return items.filter((item) => isMeaningfulQuotationItem(item));
}

function formatDisplayDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata' }).replace(/\//g, '-');
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function buildQuotationPrintHtml(quotation, options = {}) {
  const details = quotation.leadDetails || {};
  const items = meaningfulQuotationItems(quotation.items);
  const combined = isCombinedQuotation(quotation);
  const combinedTotal = combinedQuotationTotal(quotation, items);
  const hasReturnYearItems = items.some((item) => isEprConsultancyItem(item) || String(item.registrationYear || '').trim());
  const yearMappingHeader = quotationYearMappingHeader(items);
  const createdDate = quotation.createdAt ? new Date(quotation.createdAt).toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata' }).replace(/\//g, '-') : new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata' }).replace(/\//g, '-');
  const displayRows = combined ? combinedPricingRows(quotation, items) : items.map((item, index) => ({ item, index }));
  const rows = displayRows.map(({ item, index, group, groupSize, firstInGroup }, rowIndex) => `
    <tr>
      <td class="center">${rowIndex + 1}</td>
      <td>${escapeHtml(item.businessCategory || '-')}</td>
      <td>${escapeHtml(item.eprCategory || item.serviceCategory || '-')}</td>
      <td class="center date-range">${quotationServiceDateRangeHtml(item)}</td>
      <td>${escapeHtml(getQuotationApplicantType(item))}</td>
      <td>${escapeHtml(item.servicesOffered || '-')}</td>
      <td class="center">${escapeHtml(quotationUnitLabel(item))}</td>
      <td>${escapeHtml(item.unitName || '-')}</td>
      ${!combined || firstInGroup ? `<td class="amount${combined ? ' combined-amount' : ''}"${combined ? ` rowspan="${groupSize}"` : ''}>${escapeHtml(formatInr(combined ? group.basicAmount : item.basicAmount))}</td>` : ''}
    </tr>
  `).join('');
  const selectedTerms = quotationSelectedTerms(quotation);
  const terms = selectedTerms.length
    ? selectedTerms.map((term, index) => `<p>${index + 1}. ${escapeHtml(term)}</p>`).join('')
    : '<p>No terms added.</p>';
  const scopeOfWork = (quotation.scopeOfWork || []).length
    ? `<div class="scope-list">${quotation.scopeOfWork.map((item, index) => `<div class="scope-row"><span class="scope-number">${index + 1}.</span><span class="scope-text">${escapeHtml(item)}</span></div>`).join('')}</div>`
    : '<p>No scope of work added.</p>';
  const combinedPackageHeader = combined ? '<div class="package-header">Bulk Product Package Service</div>' : '';

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>${escapeHtml(quotation.quotationNumber || 'Quotation')}</title>
    <style>
      @page { size: A4; margin: 10mm; }
      * { box-sizing: border-box; }
      body { margin: 0; background: #fff; color: #111827; font-family: Arial, Helvetica, sans-serif; font-size: 12px; line-height: 1.5; text-transform: uppercase; font-weight: 400; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .page { width: 100%; min-height: 277mm; padding: 0; }
      tr { break-inside: avoid; page-break-inside: avoid; }
      thead { display: table-header-group; }
      @media screen { html { background: #e2e8f0; } body { width: 190mm; margin: 10mm auto; background: transparent; } .page { background: white; box-shadow: 0 0 0 10mm white; } .page + .page { margin-top: 20mm; } }
      .page + .page { page-break-before: always; }
      .header { display: flex; align-items: center; justify-content: space-between; padding: 12px 0 8px; border-bottom: 1px solid #020617; }
      .logo { width: 105px; height: 42px; object-fit: contain; object-position: left center; }
      .title { color: #f97316; font-size: 18px; font-weight: 900; letter-spacing: 4px; text-transform: uppercase; }
      .top { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; padding: 16px 0 16px; border-bottom: 1px solid #d1d5db; line-height: 1.5; }
      .right { text-align: right; }
      .amount { text-align: right; }
      .to { padding: 15px 0 12px; line-height: 1.55; }
      .label { font-weight: 900; }
      .strong { font-weight: 800; }
      .value { font-weight: 400; }
      p { margin: 0 0 4px; }
      table { width: 100%; table-layout: fixed; border-collapse: collapse; margin-top: 4px; }
      th { background: #f97316; color: white; border: 1px solid #020617; padding: 7px 6px; text-align: left; font-size: 11px; line-height: 1.4; font-weight: 900; text-transform: uppercase; overflow-wrap: normal; }
      td { background: #fff; border: 1px solid #020617; padding: 7px 6px; font-size: 12px; line-height: 1.4; font-weight: 700; text-transform: uppercase; overflow-wrap: anywhere; word-break: normal; }
      table:first-of-type th:nth-child(1), table:first-of-type td:nth-child(1) { text-align: center; }
      td.date-range { font-size: 10.5px; white-space: nowrap; }
      td.amount { font-weight: 800; }
      td.combined-amount { text-align: center; vertical-align: middle; font-size: 12px; }
      .center { text-align: center; }
      .package-header { margin-top: 4px; color: #020617; padding: 8px 2px; font-size: 12px; font-weight: 900; letter-spacing: 1px; text-transform: uppercase; }
      .package-header + table { margin-top: 0; }
      .terms { margin-top: 16px; line-height: 1.45; }
      .terms p { margin: 2px 0; font-weight: 400; }
      .terms li { margin: 0 0 6px; font-weight: 400; }
      .important { margin-top: 14px; line-height: 1.55; }
      .important-title { color: #ef0000; font-weight: 900; }
      .footer { margin-top: 16px; border-top: 1px solid #020617; padding-top: 14px; text-align: center; font-weight: 900; }
      .signature { margin-top: 16px; }
      .scope-page { padding-top: 18px; padding-bottom: 10mm; display: block; }
      .scope-page .terms { margin-top: 0; }
      .scope-page .footer { margin-top: 24px; break-inside: avoid; page-break-inside: avoid; }
      .scope-page-title { color: #f97316; font-size: 18px; font-weight: 900; letter-spacing: 2px; text-transform: uppercase; border-bottom: 1px solid #020617; padding-bottom: 10px; margin-bottom: 18px; }
      .scope-list { margin-top: 12px; display: grid; gap: 9px; }
      .scope-row { display: grid; grid-template-columns: 22px minmax(0, 1fr); align-items: start; column-gap: 4px; break-inside: avoid; page-break-inside: avoid; font-weight: 400; line-height: 1.5; }
      .scope-number { text-align: right; font-weight: 800; line-height: 1.5; }
      .scope-text { min-width: 0; overflow-wrap: anywhere; }
      @media print {
        html, body { width: 190mm; margin: 0; min-height: 0; }
        .page { box-shadow: none; margin: 0; }
      }
    </style>
  </head>
  <body>
    <main class="page">
      <section class="header">
        <img class="logo" src="${escapeHtml(options.logoSource || ANANT_LOGO_SOURCE_URL)}" alt="Anant Tattva">
        <div class="title">Quotation</div>
      </section>
      <section class="top">
        <div>
          <p class="label">From:</p>
          <p>${escapeHtml(quotationOwnerName(quotation))}</p>
          <p class="strong">AnantTattva Private Limited</p>
          <p>${escapeHtml(ANANT_TATTVA_ADDRESS)}</p>
          <p><span class="strong">GST Number:</span> ${ANANT_TATTVA_GST_NUMBER}</p>
        </div>
        <div class="right">
          <p>Quotation Date: ${escapeHtml(createdDate)}</p>
          <p>Quotation No.: ${escapeHtml(quotation.quotationNumber || '-')}</p>
          <p>Quotation Valid Until: ${escapeHtml(formatDisplayDate(quotation.validUntil))}</p>
          <p>Created: ${escapeHtml(createdDate)}</p>
          <p>Prepared By: ${escapeHtml(quotationPreparedByName(quotation))}</p>
        </div>
      </section>
      <section class="to">
        <p class="label">To:</p>
        <p>${escapeHtml(details.salutation || '')} ${escapeHtml(details.contactPerson || '-')} ${details.designation ? `- ${escapeHtml(details.designation)}` : ''}</p>
          <p><span class="strong">Mobile No.1:</span> ${escapeHtml(details.mobileNo1 || '-')}</p>
          <p class="strong">${escapeHtml(details.companyName || '-')}</p>
        <p>${escapeHtml([details.addressLine1, details.addressLine2, details.addressLine3].filter(Boolean).join(', ') || '-')}</p>
        <p><span class="strong">State:</span> ${escapeHtml(details.state || '-')}</p>
        <p><span class="strong">City:</span> ${escapeHtml(details.city || '-')}</p>
        <p><span class="strong">Pincode:</span> ${escapeHtml(details.pinCode || '-')}</p>
        <p><span class="strong">GST Number:</span> ${escapeHtml(details.gstNumber || '-')}</p>
      </section>
      ${combinedPackageHeader}
      <table>
        <colgroup>${[5, 13, 14, 12, 11, 15, 5, 12, 13].map((width) => `<col style="width:${width}%">`).join('')}</colgroup>
        <thead>
          <tr><th>Sr.<br>No</th><th>Business Category</th><th>Service Category</th><th>Service Period</th><th>Applicant Type</th><th>Services Offered</th><th>Unit</th><th>Unit Name</th><th>Basic Amount (INR)</th></tr>
        </thead>
        <tbody>${rows || '<tr><td colspan="9" class="center">No quotation items added.</td></tr>'}</tbody>
      </table>
      <div class="package-header">EPR / Service Period Mapping</div>
      <table>
        <thead><tr><th>Sr.<br>No</th><th>Service Category</th><th>Applicant Type</th>${hasReturnYearItems ? `<th>${escapeHtml(yearMappingHeader)}</th>` : ''}<th>Services Offered</th></tr></thead>
        <tbody>${displayRows.map(({ item }, index) => `<tr><td class="center">${index + 1}</td><td>${escapeHtml(item.eprCategory || item.serviceCategory || '-')}</td><td>${escapeHtml(getQuotationApplicantType(item))}</td>${hasReturnYearItems ? `<td>${escapeHtml(quotationAnnualReturnRegistrationYear(item))}</td>` : ''}<td>${escapeHtml(item.servicesOffered || '-')}</td></tr>`).join('') || `<tr><td colspan="${hasReturnYearItems ? 5 : 4}" class="center">No quotation items added.</td></tr>`}</tbody>
      </table>
      <section class="terms">
        <p class="label">Terms & Conditions:</p>
        ${terms}
      </section>
      <section class="important">
        <p class="important-title">Important Note:</p>
        <p>1. GST tax will be extra @ 18%.</p>
        <p>2. Any Government Charges to be paid by Client directly.</p>
      </section>
      <section class="footer">
        <p>For more details please contact us on : info@ananttattva.com | +91 8169727341 / 9004005520</p>
        <p class="signature">This is a computer-generated quotation and does not require a signature.</p>
      </section>
    </main>
    <main class="page scope-page">
      <section class="scope-page-title">Scope of Work</section>
      <section class="terms">
        <p class="label">Scope of Work:</p>
        ${scopeOfWork}
      </section>
      <section class="footer">
        <p>For more details please contact us on : info@ananttattva.com | +91 8169727341 / 9004005520</p>
        <p class="signature">This is a computer-generated quotation and does not require a signature.</p>
      </section>
    </main>
  </body>
</html>`;
}

export { buildQuotationPrintHtml, meaningfulQuotationItems, isMeaningfulQuotationItem, isCombinedQuotation, combinedQuotationTotal, normalizeCombinedPricingGroups, quotationItemKey, quotationItemsTotal, isEprConsultancyItem, quotationYearMappingHeader, isAnnualReturnQuotationService, normalizedQuotationService, isRegistrationQuotationService, combinedPricingRows, escapeHtml, quotationServiceDateRangeHtml, quotationServiceDateRange, formatServiceDate, parseDateInputValue, getQuotationApplicantType, isPlasticWasteService, quotationUnitLabel, isEprCreditItem, EPR_CREDIT_UOM_OPTIONS, formatInr, quotationSelectedTerms, quotationPaymentTerm, PAYMENT_TERM_OPTIONS, ANANT_LOGO_SOURCE_URL, quotationOwnerName, ANANT_TATTVA_ADDRESS, ANANT_TATTVA_GST_NUMBER, formatDisplayDate, quotationPreparedByName, quotationAnnualReturnRegistrationYear, quotationAnnualReturnOrCreditYears, quotationEprCreditYears, EPR_CREDIT_YEAR_OPTIONS, quotationServicePeriodYears, isPwpQuotationApplicant, isAnnualReturnRegistrationApplicant };

export function quotationFilename(quotation = {}) {
  const clientName = [quotation.leadDetails?.companyName, quotation.companyName].map(value => String(value || '').trim()).find(Boolean) || 'Client Quotation';
  const name = clientName
    .normalize('NFKC').replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ').trim().replace(/\.pdf$/i, '').replace(/^[. ]+|[. ]+$/g, '').slice(0, 170).trim();
  return `${name || 'Client Quotation'}.pdf`;
}

// The browser and server run this same layout pass, using the actual row heights.
export function paginateQuotationDocument(doc = document) {
  const original = doc.querySelector('main.scope-page');
  if (!original || original.dataset.paginated) return;
  const rows = [...original.querySelectorAll('.scope-row')];
  if (!rows.length) { original.dataset.paginated = 'true'; return; }
  const shell = original.cloneNode(true);
  shell.querySelector('.scope-list').replaceChildren();
  const anchor = original.previousElementSibling;
  original.remove();
  let previous = anchor;
  let page, list, count = 0;
  const newPage = () => {
    page = shell.cloneNode(true);
    page.dataset.paginated = 'true';
    list = page.querySelector('.scope-list');
    previous.after(page); previous = page; count = 0;
  };
  newPage();
  for (const row of rows) {
    if (count === 22) newPage();
    list.append(row);
    // 277mm is the printable A4 height with 10mm margins. The footer is included.
    if (count && page.scrollHeight > 277 * 96 / 25.4 + 1) {
      row.remove(); newPage(); list.append(row);
    }
    count++;
  }
}
