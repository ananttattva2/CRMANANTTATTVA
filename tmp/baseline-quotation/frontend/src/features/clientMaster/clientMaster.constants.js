import { buildAnnualReturnYearOptions } from './clientMaster.utils';

export const selectOptions = {
  approvalStatus: ['PENDING', 'APPROVED', 'REJECTED'],
  visibilityStatus: ['DISCONTINUED', 'LIVE', 'SUSPENDED'],
  companyType: ['Private Limited', 'LLP', 'Partnership', 'Proprietorship', 'Public Limited'],
  piboCategory: ['Producer', 'Importer', 'Brand Owner', 'Recycler', 'PWP', 'Refurbisher'],
  eprCategory: ['EPR - Plastic Waste', 'EPR - E-Waste', 'EPR - Battery Waste', 'EPR - Tyre Waste', 'EPR - Used Oil Waste'],
  // Consent issue/validity dropdowns must allow upcoming renewal years too.
  years: Array.from({ length: 26 }, (_, index) => {
    const start = 2040 - index;
    return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
  }),
  annualReturnYears: buildAnnualReturnYearOptions(),
  states: ['Gujarat', 'Maharashtra', 'Karnataka', 'Delhi', 'Rajasthan', 'Uttar Pradesh', 'Haryana', 'Tamil Nadu', 'Telangana'],
  cities: ['Ahmedabad', 'Surat', 'Mumbai', 'Pune', 'Bengaluru', 'Delhi', 'Jaipur', 'Noida', 'Gurugram', 'Chennai', 'Hyderabad'],
  cpcbStatus: ['Not Started', 'Applied', 'Under Review', 'Approved', 'Rejected'],
  msmeStatus: ['Micro', 'Small', 'Medium', 'Not Applicable'],
  msmeActivity: ['Manufacturing', 'Service', 'Trading']
};

export const quotationServiceCategoryOptions = [
  'CASE REPRESENTATION',
  'CAT-1-EOL CREDIT',
  'CAT-1-RECYCLING CREDIT',
  'CAT-2-EOL CREDIT',
  'CAT-2-RECYCLING CREDIT',
  'CAT-3-EOL CREDIT',
  'CAT-3-RECYCLING CREDIT',
  'CATEGORY 1',
  'CATEGORY 2',
  'CATEGORY 3',
  'CGWA NOC FRESH APPLICATION',
  'CONSULTANCY FEE',
  'CPCB NOTICE REPLY FEES',
  'CTE & CTO NEW REGISTRATION',
  'CTE – CONSENT TO ESTABLISH',
  'CTO – CONSENT TO OPERATE',
  'CTO – RENEWAL',
  'E-WASTE CREDIT',
  'ENVIRONMENT STATEMENT FORM V SUBMISSION',
  'EPR CREDIT RE',
  'EPR CREDIT REVENUE SHARING',
  'EPR ETP PORTAL HANDLING CHARGES',
  'EPR LOGIN SURRENDER',
  'GOVT. REPRESENTATION CHARGES',
  'KAVACH AUDIT',
  'MATERIAL WASTE DISPOSAL CONSULTANCY',
  'PLANT AUDIT',
  'PORTAL HEALTH REPORT CONSULTANCY',
  'SAP INTEGRATION SUPPORT',
  'UREP ASSESSMENT AND CONSULTING'
];
