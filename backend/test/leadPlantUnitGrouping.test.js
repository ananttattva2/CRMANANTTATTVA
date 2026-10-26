const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const leadController = require('../src/controllers/leadController');

function service(id, plantUnit) {
  return {
    assignedServiceId: id,
    industryType: 'Manufacturing',
    businessCategory: 'EPR Consultancy',
    eprCategory: 'EPR - Plastic Waste',
    applicantType: 'PIBO',
    subApplicantType: 'Producer',
    servicesOffered: `Service ${id}`,
    plantUnit,
    firstAnnualReturnYearApplicable: '2026-27'
  };
}

function address(id, plantUnit) {
  return { assignedServiceId: id, plantUnit, addressLine1: 'Factory', state: 'Delhi', city: 'Delhi', pinCode: '110001' };
}

function contact(id, plantUnit) {
  return { assignedServiceId: id, plantUnit, salutation: 'Mr', contactPerson: 'Test', designation: 'Manager', emails: 'test@example.com', mobileNo1: '9999999999', referredBy: 'Admin', source: 'Referral' };
}

function assignment(id, plantUnit) {
  return { assignedServiceId: id, plantUnit };
}

function payload(units) {
  const serviceSelections = units.map((unit, index) => service(`service-${index + 1}`, unit));
  const distinct = [...new Map(serviceSelections.map((row) => [row.plantUnit, row])).values()];
  return {
    status: 'Potential - Interested', company: 'Example Pvt Ltd', servicesOffered: 'Service service-1',
    addressLine1: 'Factory', state: 'Delhi', city: 'Delhi', pinCode: '110001',
    eprCategory: 'EPR - Plastic Waste', subApplicantType: 'Producer',
    serviceSelections,
    addresses: distinct.map((row) => address(row.assignedServiceId, row.plantUnit)),
    contacts: distinct.map((row) => contact(row.assignedServiceId, row.plantUnit)),
    assignments: serviceSelections.map((row) => assignment(row.assignedServiceId, row.plantUnit))
  };
}

test('one Address and Contact is valid when three services share Unit 1', () => {
  assert.equal(leadController._test.validateSubmittedLead(payload(['Unit 1', 'Unit 1', 'Unit 1'])), '');
});

test('Address and Contact count follows distinct Plant Units', () => {
  assert.equal(leadController._test.validateSubmittedLead(payload(['Unit 1', 'Unit 1', 'Unit 2'])), '');
  assert.equal(leadController._test.validateSubmittedLead(payload(['Unit 1', 'Unit 2', 'Unit 3'])), '');
});

test('Plant Unit options and backend sanitization support Unit 15', () => {
  const leadPage = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/LeadGeneration.jsx'), 'utf8');
  assert.match(leadPage, /PLANT_UNIT_OPTIONS = Array\.from\(\{ length: 15 \}/);
  const cleaned = leadController._test.cleanBody({ serviceSelections: [service('service-15', 'Unit 15')] });
  assert.equal(cleaned.serviceSelections[0].plantUnit, 'Unit 15');
});

test('frontend groups shared lead data by Plant Unit and Client Master fetches by unit', () => {
  const leadPage = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/LeadGeneration.jsx'), 'utf8');
  const clientMaster = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/ClientMaster.jsx'), 'utf8');
  assert.match(leadPage, /function plantUnitGroups\(services = \[\]\)/);
  assert.match(leadPage, /alignRowsToPlantUnits\(serviceRows, lead\.addresses, createAddressRow\)/);
  assert.match(leadPage, /alignRowsToPlantUnits\(serviceRows, lead\.contacts, createContactRow\)/);
  assert.match(leadPage, /const usedRows = new Set\(\)/);
  assert.match(clientMaster, /item\?\.plantUnit === row\.plantUnit/);
});

test('additional Address and Contact rows are valid and retained for database storage', () => {
  const data = payload(['Unit 1']);
  data.addresses.push({ ...address('', 'Unit 2'), addressLine1: 'Additional Office' });
  data.contacts.push({ ...contact('', 'Unit 2'), contactPerson: 'Additional Contact', emails: 'additional@example.com' });

  assert.equal(leadController._test.validateSubmittedLead(data), '');
  const cleaned = leadController._test.cleanBody(data);
  assert.equal(cleaned.addresses.length, 2);
  assert.equal(cleaned.addresses[1].addressLine1, 'Additional Office');
  assert.equal(cleaned.contacts.length, 2);
  assert.equal(cleaned.contacts[1].contactPerson, 'Additional Contact');
});

test('Add Address and Add Contact require confirmation and assign the next unit', () => {
  const leadPage = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/LeadGeneration.jsx'), 'utf8');
  assert.match(leadPage, /function nextPlantUnit\(\.\.\.rowGroups\)/);
  assert.match(leadPage, /setAddRowConfirmation\('address'\)/);
  assert.match(leadPage, /setAddRowConfirmation\('contact'\)/);
  assert.match(leadPage, /Are you sure you want to add a new \{addRowConfirmation\} row\?/);
  assert.match(leadPage, /No, Cancel/);
  assert.match(leadPage, /Yes, Add \{addRowConfirmation === 'address' \? 'Address' : 'Contact'\}/);
  assert.match(leadPage, /createAddressRow\(\{ plantUnit \}\)/);
  assert.match(leadPage, /createContactRow\(\{ plantUnit \}\)/);
  assert.match(leadPage, /const result = \[\.\.\.alignedRows, \.\.\.additionalRows\]/);
});

test('frontend removes generated blank detail rows and remaps legacy saved rows', () => {
  const leadPage = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/LeadGeneration.jsx'), 'utf8');
  assert.match(leadPage, /function compactDetailRows\(savedRows = \[\]\)/);
  assert.match(leadPage, /rows\.filter\(hasDetailRowData\)/);
  assert.match(leadPage, /hasDetailRowData\(row\) && \(!savedUnit \|\| !activeUnits\.has\(savedUnit\)\)/);
  assert.match(leadPage, /disabled=\{\(rowFrozen && hasDetailRowData\(row\)\) \|\| addressRows\.length === 1\}/);
  assert.match(leadPage, /disabled=\{\(rowFrozen && hasDetailRowData\(row\)\) \|\| contactRows\.length === 1\}/);
});

test('backend keeps every newly added Address and Contact row for database storage', () => {
  const cleaned = leadController._test.cleanBody({
    addresses: [
      address('service-1', 'Unit 1'),
      { ...address('', 'Unit 2'), addressLine1: 'Branch Office', pinCode: '400001' }
    ],
    contacts: [
      contact('service-1', 'Unit 1'),
      { ...contact('', 'Unit 2'), contactPerson: 'Second Contact', emails: 'second@example.com' }
    ]
  });

  assert.equal(cleaned.addresses.length, 2);
  assert.equal(cleaned.addresses[1].plantUnit, 'Unit 2');
  assert.equal(cleaned.addresses[1].addressLine1, 'Branch Office');
  assert.equal(cleaned.contacts.length, 2);
  assert.equal(cleaned.contacts[1].plantUnit, 'Unit 2');
  assert.equal(cleaned.contacts[1].contactPerson, 'Second Contact');
  assert.equal(cleaned.contacts[1].emails, 'second@example.com');
});
