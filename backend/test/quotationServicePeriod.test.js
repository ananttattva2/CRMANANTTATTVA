const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const quotationController = require('../src/controllers/quotationController');
const {
  renewalDateFrom,
  serviceEndDateFrom
} = require('../src/utils/servicePeriod');

test('service period date calculations support days, calendar months, and annual periods', () => {
  assert.equal(serviceEndDateFrom('2026-08-07', 10, 'days'), '2026-08-16');
  assert.equal(renewalDateFrom('2026-08-07', 10, 'days'), '2026-08-17');
  assert.equal(serviceEndDateFrom('2026-08-07', 3, 'months'), '2026-11-06');
  assert.equal(renewalDateFrom('2026-08-07', 3, 'months'), '2026-11-07');
  assert.equal(serviceEndDateFrom('2026-08-07', 1, 'annual'), '2027-08-06');
  assert.equal(renewalDateFrom('2026-08-07', 1, 'annual'), '2027-08-07');
  assert.equal(serviceEndDateFrom('2026-08-07', 2, 'annual'), '2028-08-06');
  assert.equal(renewalDateFrom('2026-08-07', 2, 'annual'), '2028-08-07');
});

test('calendar period calculations clamp month-end and leap-day renewals', () => {
  assert.equal(renewalDateFrom('2027-01-31', 1, 'months'), '2027-02-28');
  assert.equal(serviceEndDateFrom('2027-01-31', 1, 'months'), '2027-02-27');
  assert.equal(renewalDateFrom('2024-02-29', 1, 'annual'), '2025-02-28');
  assert.equal(serviceEndDateFrom('2024-02-29', 1, 'annual'), '2025-02-27');
});

test('legacy quotation items without a period unit remain annual', () => {
  const legacyItems = [{ serviceCategory: 'EPR - Execution', servicePeriod: 1, serviceStartDate: '2026-08-07' }];
  const body = quotationController._test.cleanBody({
    items: legacyItems
  }, null, legacyItems);
  assert.equal(body.items[0].periodUnit, 'annual');
  assert.equal(body.items[0].serviceEndDate, '2027-08-06');
});

test('quotation unit name is sanitized and persisted separately from unit and UOM', () => {
  const body = quotationController._test.cleanBody({
    items: [{
      serviceCategory: 'EPR - Execution', servicePeriod: 1, periodUnit: 'annual',
      serviceStartDate: '2026-08-07', unitName: '  Mumbai Factory Unit  '
    }]
  });
  assert.equal(body.items[0].unit, '1');
  assert.equal(body.items[0].unitName, 'Mumbai Factory Unit');
});

test('quotation form, view, and printable download expose Unit Name', () => {
  const page = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/Quotations.jsx'), 'utf8');
  assert.match(page, /Unit Name for quotation item/);
  assert.match(page, /item\.unitName \|\| '-'/);
  assert.match(page, /<th>Unit Name<\/th>/);
});

test('quotation API sanitization rejects invalid units and non-integer periods', () => {
  assert.throws(
    () => quotationController._test.cleanBody({ items: [{ serviceCategory: 'EPR - Execution', servicePeriod: 1, serviceStartDate: '2026-08-07' }] }),
    /Select Period must be Days, Month, or Annual/
  );
  assert.throws(
    () => quotationController._test.cleanBody({ items: [{ serviceCategory: 'EPR - Execution', servicePeriod: 1, periodUnit: 'weeks', serviceStartDate: '2026-08-07' }] }),
    /Select Period must be Days, Month, or Annual/
  );
  assert.throws(
    () => quotationController._test.cleanBody({ items: [{ serviceCategory: 'EPR - Execution', servicePeriod: 1.5, periodUnit: 'months', serviceStartDate: '2026-08-07' }] }),
    /whole number/
  );
  assert.throws(
    () => quotationController._test.cleanBody({ items: [{ serviceCategory: 'EPR - Execution', servicePeriod: 1, periodUnit: 'annual', transitionPeriod: 'Maybe', serviceStartDate: '2026-08-07' }] }),
    /Transition Period must be Yes or No/
  );
});

test('EPR Credit quotations require KG or MT UOM and normalize it', () => {
  assert.throws(
    () => quotationController._test.cleanBody({ items: [{ businessCategory: 'EPR Credit', serviceCategory: 'EPR - Execution', servicePeriod: 1, periodUnit: 'annual', serviceStartDate: '2026-08-07' }] }),
    /UOM must be KG or MT/
  );
  const body = quotationController._test.cleanBody({ items: [{ businessCategory: 'EPR Credit', unitLabel: 'kg', annualReturnEprCreditYears: ['2024-25'], serviceCategory: 'EPR - Execution', servicePeriod: 1, periodUnit: 'annual', serviceStartDate: '2026-08-07' }] });
  assert.equal(body.items[0].unit, '1');
  assert.equal(body.items[0].unitLabel, 'KG');
  assert.equal(body.items[0].servicePeriod, 0);
  assert.equal(body.items[0].periodUnit, 'annual');
  assert.equal(body.items[0].serviceStartDate, '');
  assert.equal(body.items[0].serviceEndDate, '');
});

test('EPR Credit accepts the dashed business label and always clears legacy service-period values', () => {
  const body = quotationController._test.cleanBody({ items: [{
    businessCategory: 'EPR - Credit', unitLabel: 'MT', annualReturnEprCreditYears: ['2025-26'],
    serviceCategory: 'EPR - Execution', servicePeriod: 25, periodUnit: 'days', transitionPeriod: 'Yes',
    serviceStartDate: '2026-08-07', serviceEndDate: '2026-09-01'
  }] });
  assert.equal(body.items[0].businessCategory, 'EPR Credit');
  assert.equal(body.items[0].servicePeriod, 0);
  assert.equal(body.items[0].periodUnit, 'annual');
  assert.equal(body.items[0].transitionPeriod, 'No');
  assert.equal(body.items[0].serviceStartDate, '');
  assert.equal(body.items[0].serviceEndDate, '');
});

test('quotation updates preserve business category and assigned service identity', () => {
  const existing = [{
    assignedServiceId: 'service_assignment_002', sourceServiceIndex: 1,
    businessCategory: 'EPR Consultancy', serviceCategory: 'Consent Compliance Services',
    servicePeriod: 1, periodUnit: 'annual', serviceStartDate: '2026-08-07'
  }];
  const body = quotationController._test.cleanBody({ items: [{
    ...existing[0], businessCategory: '', basicAmount: 15000
  }] }, null, existing);
  assert.equal(body.items[0].businessCategory, 'EPR Consultancy');
  assert.equal(body.items[0].assignedServiceId, 'service_assignment_002');
});

test('quotation accepts a custom business category from Lead Generation', () => {
  const body = quotationController._test.cleanBody({
    items: [{ businessCategory: 'Other Consultancy', registrationYear: '2026-27', serviceCategory: 'Solid Waste Management', servicePeriod: 1, periodUnit: 'annual' }]
  });
  assert.equal(body.items[0].businessCategory, 'Other Consultancy');
  assert.equal(body.items[0].registrationYear, '2026-27');
});

test('Other Consultancy requires a supported registration year and clears it for other categories', () => {
  assert.throws(
    () => quotationController._test.cleanBody({ items: [{ businessCategory: 'Other Consultancy', serviceCategory: 'Solid Waste Management', servicePeriod: 1, periodUnit: 'annual' }] }),
    /select a Registration Year from 2022-23 to 2029-30/
  );
  assert.throws(
    () => quotationController._test.cleanBody({ items: [{ businessCategory: 'Other Consultancy', registrationYear: '2030-31', serviceCategory: 'Solid Waste Management', servicePeriod: 1, periodUnit: 'annual' }] }),
    /select a Registration Year from 2022-23 to 2029-30/
  );
  const regular = quotationController._test.cleanBody({ items: [{ businessCategory: 'EPR Consultancy', registrationYear: '2026-27', serviceCategory: 'EPR - Execution', servicePeriod: 1, periodUnit: 'annual' }] });
  assert.equal(regular.items[0].registrationYear, undefined);
});

test('EPR Credit years are required, validated, persisted, and cleared for consultancy items', () => {
  assert.throws(
    () => quotationController._test.cleanBody({ items: [{ businessCategory: 'EPR Credit', unitLabel: 'MT', serviceCategory: 'EPR - Execution', servicePeriod: 1, periodUnit: 'annual', serviceStartDate: '2026-08-07' }] }),
    /select at least one Annual Return EPR Credit Year/
  );
  assert.throws(
    () => quotationController._test.cleanBody({ items: [{ businessCategory: 'EPR Credit', unitLabel: 'MT', annualReturnEprCreditYears: ['2030-31'], serviceCategory: 'EPR - Execution', servicePeriod: 1, periodUnit: 'annual', serviceStartDate: '2026-08-07' }] }),
    /unsupported financial year/
  );
  const credit = quotationController._test.cleanBody({ items: [{ businessCategory: 'EPR Credit', unitLabel: 'MT', annualReturnEprCreditYears: ['2025-26', '2024-25', '2025-26'], applicantType: 'Recycler', serviceCategory: 'EPR - Used Oil', servicePeriod: 1, periodUnit: 'annual', serviceStartDate: '2026-08-07' }] });
  assert.deepEqual(credit.items[0].annualReturnEprCreditYears, ['2025-26', '2024-25']);
  assert.equal(credit.items[0].applicantType, 'Recycler');
  const consultancy = quotationController._test.cleanBody({ items: [{ businessCategory: 'EPR Consultancy', annualReturnEprCreditYears: ['2024-25'], serviceCategory: 'EPR - Execution', servicePeriod: 1, periodUnit: 'annual', serviceStartDate: '2026-08-07' }] });
  assert.deepEqual(consultancy.items[0].annualReturnEprCreditYears, []);
});

test('PWP EPR Credit allows zero amount without dates or annual-return year mappings', () => {
  const body = quotationController._test.cleanBody({
    pricingMode: 'individual',
    items: [{ businessCategory: 'EPR Credit', applicantType: 'PWP', piboCategory: 'PWP', unitLabel: 'KG', basicAmount: 0, serviceCategory: 'EPR - Plastic Waste' }]
  });
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].basicAmount, 0);
  assert.equal(body.items[0].serviceStartDate, '');
  assert.equal(body.items[0].serviceEndDate, '');
  assert.deepEqual(body.items[0].annualReturnYears, []);
  assert.deepEqual(body.items[0].annualReturnEprCreditYears, []);
  assert.doesNotThrow(() => quotationController._test.validateQuotationItemDates(body.items));
});

test('transition dates are system-derived and frozen against update payloads', () => {
  const existing = [{
    id: 'service-1', serviceCategory: 'EPR - Plastic Waste', servicePeriod: 1, periodUnit: 'annual',
    transitionPeriod: 'Yes', serviceStartDate: '2026-04-01', serviceEndDate: '2027-03-31'
  }];
  const body = quotationController._test.cleanBody({
    items: [{
      ...existing[0], serviceStartDate: '2030-01-01', serviceEndDate: '2035-01-01'
    }]
  }, null, existing);
  assert.equal(body.items[0].serviceStartDate, '2026-04-01');
  assert.equal(body.items[0].serviceEndDate, '2027-03-31');

  const created = quotationController._test.cleanBody({
    items: [{
      serviceCategory: 'EPR - Plastic Waste', servicePeriod: 1, periodUnit: 'annual', transitionPeriod: 'Yes',
      annualReturnYears: ['2026-27'], serviceStartDate: '2030-01-01', serviceEndDate: '2035-01-01'
    }]
  });
  assert.equal(created.items[0].serviceStartDate, '2026-04-01');
  assert.equal(created.items[0].serviceEndDate, '2027-03-31');

  const autoStarted = quotationController._test.cleanBody({
    quotationDate: '2026-08-07',
    items: [{ serviceCategory: 'EPR - Execution', servicePeriod: 3, periodUnit: 'months', transitionPeriod: 'Yes' }]
  });
  assert.equal(autoStarted.items[0].serviceStartDate, '2026-08-07');
  assert.equal(autoStarted.items[0].serviceEndDate, '2026-11-06');
});

test('period controls appear in the mapping popup and not in the main quotation table', () => {
  const page = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/Quotations.jsx'), 'utf8');
  assert.match(page, /const financialYearEprYearHeading = financialYearIsRegistration \? 'Registration EPR Year' : 'Annual Return EPR Year'/);
  assert.match(page, /'Service Period', 'Select Period', 'Transition Period', \.\.\.\(financialYearNeedsEprData \? \[financialYearEprYearHeading\]/);
  assert.match(page, /\[financialYearEprYearHeading\]\s*:\s*\[\]\), \.\.\.\(financialYearNeedsEprCreditYears \? \['Annual Return EPR Credit Years'\]/);
  assert.match(page, /'Annual Return EPR Credit Years'\]\s*:\s*\[\]\), 'Applicant Type', \.\.\.\(financialYearNeedsRegistrationYear \? \['Registration Year'\]/);
  assert.match(page, /financialYearDraft\.transitionPeriod \|\| 'No'.*TRANSITION_PERIOD_OPTIONS/s);
  assert.doesNotMatch(page, /'EPR \/ Service Period', 'Select Period', 'Transition Period', 'Industry Type'/);
  assert.match(page, /periodDisplay\(financialYearDraft\.servicePeriod, financialYearDraft\.periodUnit\)/);
});

test('Other Consultancy exposes a required Registration Year after Applicant Type in both screens', () => {
  const page = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/Quotations.jsx'), 'utf8');
  const model = fs.readFileSync(path.resolve(__dirname, '../src/models/Quotation.js'), 'utf8');
  assert.match(page, /function isOtherConsultancyItem\(item = \{\}\)/);
  assert.match(page, /'Applicant Type', 'Registration Year', 'Added By'/);
  assert.match(page, /'Applicant Type', \.\.\.\(financialYearNeedsRegistrationYear \? \['Registration Year'\] : \[\]\), 'Service Category'/);
  assert.match(page, /placeholder="Select registration year" categoryLabel="Registration Year"/);
  assert.match(page, /Select a Registration Year for the Other Consultancy quotation item/);
  assert.match(model, /registrationYear: \{ type: String[\s\S]*2022-23[\s\S]*2029-30/);
});

test('EPR Credit period controls are disabled and validity notes use business category and quotation validity', () => {
  const page = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/Quotations.jsx'), 'utf8');
  assert.match(page, /disabled=\{financialYearNeedsEprCreditYears\}/);
  assert.match(page, /financialYearNeedsEprCreditYears \? 'N\/A'/);
  assert.match(page, /The EPR – Credit rates are valid till:/);
  assert.match(page, /servicePeriodValidityNote\(financialYearDraft, quotation\.validUntil\)/);
  assert.match(page, /item\.businessCategory \? ` for \$\{item\.businessCategory\}`/);
  assert.doesNotMatch(page, /item\.serviceCategory \? ` for \$\{item\.serviceCategory\}`/);
});

test('quotation items rehydrate current lead service fields without replacing quotation pricing', () => {
  const page = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/Quotations.jsx'), 'utf8');
  assert.match(page, /function syncQuotationItemsWithLead\(items = \[\], lead = \{\}\)/);
  assert.match(page, /service\.assignedServiceId \|\| assignedServiceId/);
  assert.match(page, /applicantType: service\.applicantType \|\| ''/);
  assert.match(page, /subApplicantType: service\.subApplicantType \|\| service\.piboCategory \|\| ''/);
  assert.match(page, /servicesOffered: service\.servicesOffered \|\| ''/);
  assert.match(page, /businessCategory: service\.businessCategory \|\| ''/);
  assert.doesNotMatch(page.match(/function syncQuotationItemsWithLead[\s\S]*?\n\}/)?.[0] || '', /basicAmount:/);
  assert.match(page, /function syncQuotationWithLead\(quotation = \{\}, lead = \{\}\)/);
  assert.match(page, /leadDetails: mapLeadToDetails\(lead\)/);
  assert.match(page, /items: syncQuotationItemsWithLead\(quotation\.items, lead\)/);
  assert.match(page, /syncQuotationWithLead\(saved, lead\)/);
});

test('quotation UI shares applicant fallback logic and conditionally renders EPR Credit years', () => {
  const page = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/Quotations.jsx'), 'utf8');
  const model = fs.readFileSync(path.resolve(__dirname, '../src/models/Quotation.js'), 'utf8');
  assert.match(page, /function getQuotationApplicantType\(item = \{\}, source = \{\}\)/);
  assert.match(page, /source\.subApplicantType \|\| source\.piboCategory \|\| item\.subApplicantType \|\| item\.piboCategory \|\| source\.applicantType/);
  assert.match(page, /financialYearNeedsEprCreditYears && <td[^>]*><QuoteYearMultiSelect/);
  assert.match(page, /Please select at least one Annual Return EPR Credit Year/);
  assert.match(page, /function isPwpEprCreditItem\(item = \{\}\)/);
  assert.match(page, /isPwpEprCreditItem\(item\) \? <span[^>]*>Not required<\/span>/);
  assert.match(page, /String\(item\.basicAmount \?\? ''\)\.trim\(\) === '' \|\| Number\(item\.basicAmount\) < 0/);
  assert.match(page, /getQuotationApplicantType\(financialYearDraft\)/);
  assert.match(page, /quotationEprCreditYears\(item\)\.join\(', '\)/);
  assert.match(model, /annualReturnEprCreditYears:[\s\S]*2022-23[\s\S]*2029-30/);
  assert.match(model, /applicantType: \{ type: String/);
  assert.match(model, /subApplicantType: \{ type: String/);
});

test('quotation views and printable tables omit period-unit and transition columns', () => {
  const page = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/Quotations.jsx'), 'utf8');
  assert.doesNotMatch(page, /'Business Category', 'Service Category', 'Service Period', 'Select Period', 'Transition Period'/);
  assert.doesNotMatch(page, /<th[^>]*>Select Period<\/th>/);
  assert.doesNotMatch(page, /<th[^>]*>Transition Period<\/th>/);
  assert.doesNotMatch(page, /QuoteModalStat label="(?:Select Period|Transition Period)"/);
  assert.doesNotMatch(page, /\['Select Period', periodUnitLongLabel/);
});

test('quotation PDF main amount table shows service start and end dates in the service period column', () => {
  const page = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/Quotations.jsx'), 'utf8');
  assert.match(page, /function quotationServiceDateRange\(item = \{\}\)/);
  assert.match(page, /return `\$\{formatServiceDate\(startDate\)\} - \$\{formatServiceDate\(endDate\)\}`/);
  assert.match(page, /function QuotationServiceDateRangeCell\(\{ item \}\)/);
  assert.match(page, /block whitespace-nowrap/);
  assert.match(page, /replace\('\s-\s', '\s-<br>'\)/);
  assert.match(page, /'Sr\.No', 'Business Category', 'Service Category', 'Service Period', 'Applicant Type'/);
  assert.match(page, /<tr><th>Sr\.No<\/th><th>Business Category<\/th><th>Service Category<\/th><th>Service Period<\/th><th>Applicant Type<\/th>/);
  assert.match(page, /<QuotationServiceDateRangeCell item=\{item\} \/>/);
  assert.match(page, /quotationServiceDateRangeHtml\(item\)/);
  assert.doesNotMatch(page, /quotationPrimaryPeriodHeader|quotationPrimaryPeriodDisplay/);
  assert.match(page, /Annual Return EPR Year \/ Credit Year/);
  assert.match(page, /quotationAnnualReturnRegistrationYear\(item\)/);
  assert.doesNotMatch(page, /EPR \/ Service Period<\/th><th[^>]*>Applicant Type/);
  assert.match(page, /const ANANT_TATTVA_GST_NUMBER = '27AAZCA6657R1ZB'/);
});

test('EPR Consultancy quotation mapping labels the year column from services offered', () => {
  const page = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/Quotations.jsx'), 'utf8');
  assert.match(page, /function normalizedQuotationService\(item = \{\}\)/);
  assert.match(page, /normalizedQuotationService\(item\)\.includes\('annualreturn'\)/);
  assert.match(page, /normalizedQuotationService\(item\)\.includes\('registration'\)/);
  assert.match(page, /function quotationYearMappingHeader\(items = \[\]\)/);
  assert.match(page, /if \(hasAnnualReturn && !hasRegistration\) return 'Annual Return Year'/);
  assert.match(page, /if \(hasRegistration && !hasAnnualReturn\) return 'Registration EPR Year'/);
  assert.match(page, /return 'EPR Year'/);
  assert.match(page, /\{quotationYearMappingHeader\(items\)\}/);
  assert.match(page, /escapeHtml\(yearMappingHeader\)/);
});

test('quotation mapping view and print hide the EPR service period column', () => {
  const page = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/Quotations.jsx'), 'utf8');
  assert.doesNotMatch(page, /<th className="border-r border-t border-slate-950 px-2 py-3">EPR \/ Service Period<\/th>/);
  assert.doesNotMatch(page, /<td className="border-r border-t border-slate-950 px-2 py-3">\{quotationServicePeriodDisplay\(item\)\}<\/td>/);
  assert.doesNotMatch(page, /<th>Service Category<\/th><th>EPR \/ Service Period<\/th>/);
});

test('quotation mapping view and download place Applicant Type beside Service Category', () => {
  const page = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/Quotations.jsx'), 'utf8');
  assert.match(page, />Service Category<\/th><th[^>]*>Applicant Type<\/th>\{hasReturnYearItems/);
  assert.match(page, /\{item\.eprCategory \|\| item\.serviceCategory \|\| '-'\}<\/td><td[^>]*>\{getQuotationApplicantType\(item\)\}<\/td>\{hasReturnYearItems/);
  assert.match(page, /<th>Service Category<\/th><th>Applicant Type<\/th>\$\{hasReturnYearItems/);
  assert.match(page, /escapeHtml\(item\.eprCategory \|\| item\.serviceCategory \|\| '-'\)\}<\/td><td>\$\{escapeHtml\(getQuotationApplicantType\(item\)\)\}<\/td>/);
});

test('quotation year mapping shows selected or service-period EPR years, including PWP, while EPR Credit stays blank', () => {
  const page = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/Quotations.jsx'), 'utf8');
  assert.match(page, /function isAnnualReturnRegistrationApplicant\(item = \{\}\)/);
  assert.match(page, /applicantType === 'producer' \|\| applicantType === 'importerofrawmaterial'/);
  assert.match(page, /function isPwpQuotationApplicant\(item = \{\}\)/);
  assert.match(page, /function quotationAnnualReturnRegistrationYear\(item = \{\}\)/);
  assert.match(page, /if \(isEprCreditItem\(item\)\) return ''/);
  assert.match(page, /function quotationServicePeriodYears\(item = \{\}\)/);
  assert.match(page, /const displayedYears = selectedYears\.length \? selectedYears : quotationServicePeriodYears\(item\)/);
  assert.match(page, /if \(isPwpQuotationApplicant\(item\)\) return displayedYears\.join\(', '\) \|\| item\.financialYear \|\| '-'/);
  assert.match(page, /if \(isEprConsultancyItem\(item\)\) \{\s*return displayedYears\.join\(', '\) \|\| item\.financialYear \|\| '-'/);
  assert.match(page, /if \(!isAnnualReturnRegistrationApplicant\(item\)\) return '-'/);
  assert.equal((page.match(/const hasReturnYearItems = items\.some\(\(item\) => isEprConsultancyItem\(item\) \|\| String\(item\.registrationYear \|\| ''\)\.trim\(\)\)/g) || []).length, 2);
  assert.doesNotMatch(page, /hidePwpRegistrationYearColumn/);
});

test('quotation PDF download requires approval for non-admin users', () => {
  const page = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/Quotations.jsx'), 'utf8');
  assert.match(page, /QuotationPreviewDrawer quotation=\{previewQuotation\} currentUser=\{currentUser\}/);
  assert.match(page, /const canDownloadPdf = isAdminUser \|\| isQuotationApproved/);
  assert.match(page, /if \(!canDownloadPdf\) \{/);
  assert.match(page, /disabled=\{downloadingPdf \|\| !canDownloadPdf\}/);
  assert.match(page, /PDF download will be available after this quotation is approved/);
});

test('quotation download uses the client name and preserves each designed page boundary', () => {
  const page = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/Quotations.jsx'), 'utf8');
  assert.match(page, /details\.companyName \|\| quotation\.quotationNumber/);
  assert.match(page, /const sections = \[\.\.\.documentRef\.current\.children\]/);
  assert.match(page, /const pages = sections\.length \? sections : \[documentRef\.current\]/);
  assert.doesNotMatch(page, /const pagePixelHeight/);
  assert.match(page, /class="scope-row"/);
  assert.match(page, /grid-template-columns: 22px minmax\(0, 1fr\)/);
  assert.match(page, /page-break-inside: avoid/);
  assert.doesNotMatch(page, /\.scope-page \.footer \{ margin-top: auto;/);
});

test('quotation PDF capture bypasses desktop zoom and uses a high-resolution canvas', () => {
  const page = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/Quotations.jsx'), 'utf8');
  assert.match(page, /appRoot\.style\.zoom = '1'/);
  assert.match(page, /documentRef\.current\.style\.width = '760px'/);
  assert.match(page, /scale: 2\.5/);
  assert.match(page, /appRoot\.style\.zoom = previousRootZoom/);
  assert.match(page, /documentRef\.current\.style\.width = previousDocumentWidth/);
});

test('quotation preview keeps business and service categories inside separate cells', () => {
  const page = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/Quotations.jsx'), 'utf8');
  const density = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/styles/modules/14-desktop-density.css'), 'utf8');
  assert.match(page, /<col className="w-\[5%\]" \/><col className="w-\[14%\]" \/><col className="w-\[16%\]"/);
  assert.match(page, /\[overflow-wrap:anywhere\]/);
  assert.match(page, /overflow-wrap: anywhere; word-break: normal/);
  assert.match(density, /\[data-quotation-pdf\] table th/);
  assert.match(density, /font-size: 9px !important/);
  assert.match(density, /\[data-quotation-pdf\] table td/);
  assert.match(density, /font-size: 10px !important/);
});

test('quotation selects safely normalize object and string options before filtering', () => {
  const page = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/Quotations.jsx'), 'utf8');
  assert.match(page, /option && typeof option === 'object'/);
  assert.match(page, /`\$\{option\.label\} \$\{option\.value\}`\.toLowerCase\(\)/);
  assert.doesNotMatch(page, /options\.filter\(\(option\) => option\.toLowerCase\(\)/);
});
