const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/ClientMaster.jsx'), 'utf8');

test('service picker groups registration and annual return by applicant and sub-applicant only', () => {
  const context = vm.createContext({ readAssignedServiceId: row => row.assignedServiceId, clientMasterServiceFingerprint: row => row.servicesOffered || '' });
  vm.runInContext(source.slice(source.indexOf('function clientMasterGroupingIdentity'), source.indexOf('function legacyServiceFingerprintCompatible')), context);
  vm.runInContext(source.slice(source.indexOf('function uniqueClientMasterServices'), source.indexOf('function activateAssignedService')), context);
  const base = { applicantType:'PIBO', subApplicantType:'Brand Owner', plantUnit:'Unit 1', eprCategory:'EPR - Plastic Waste' };
  const rows = [{...base,assignedServiceId:'registration',servicesOffered:'New Registration'}, {...base,assignedServiceId:'annual',servicesOffered:'Annual Return Filling'}, {...base,assignedServiceId:'annual-duplicate',servicesOffered:'Annual Filling'}, {...base,plantUnit:'Unit 2',assignedServiceId:'unit2',servicesOffered:'Annual Return Filling'}];
  assert.deepEqual(Array.from(context.uniqueClientMasterServices(rows), row => row.assignedServiceId), ['registration']);
});

test('service picker collapses identical assigned services even when the plant unit is missing', () => {
  const context = vm.createContext({ readAssignedServiceId: row => row.assignedServiceId, clientMasterServiceFingerprint: row => ['Manufacturing', '', row.eprCategory, row.applicantType, row.subApplicantType, row.servicesOffered, '', row.plantUnit || ''].join(':') });
  vm.runInContext(source.slice(source.indexOf('function clientMasterGroupingIdentity'), source.indexOf('function legacyServiceFingerprintCompatible')), context);
  vm.runInContext(source.slice(source.indexOf('function uniqueClientMasterServices'), source.indexOf('function activateAssignedService')), context);
  const rows = [
    { assignedServiceId:'producer-original', applicantType:'PIBO', subApplicantType:'Producer', eprCategory:'EPR - Plastic Waste', servicesOffered:'Annual Return Filling' },
    { assignedServiceId:'producer-duplicate', applicantType:'PIBO', subApplicantType:'Producer', eprCategory:'EPR - Plastic Waste', servicesOffered:'New Registration' }
  ];
  assert.deepEqual(Array.from(context.uniqueClientMasterServices(rows), row => row.assignedServiceId), ['producer-original']);
});

test('selecting a company opens service selection for one or multiple services without onboarding automatically', async () => {
  const start = source.indexOf('async function handleLeadSelect(');
  const end = source.indexOf('    const service = selectedService || visibleServices[0]', start);
  for (const count of [1,2]) {
    let pending;
    const services = Array.from({length:count}, (_,index)=>({assignedServiceId:`service-${index}`}));
    const context = vm.createContext({getVisibleServiceRows:()=>services, clientRecordRequestRef:{current:0}, emptyClient:{}, setClient:()=>{},setEditingClientId:()=>{},setEditingWorkflowStatus:()=>{},setNotice:()=>{},setError:()=>{},setPendingLeadServices:value=>{pending=value;},beginServiceOnboarding:()=>{throw new Error('Company selection must wait for service choice');}});
    vm.runInContext(`${source.slice(start,end)}\n}`,context);
    await context.handleLeadSelect('lead',null,{company:'ADVINNOV MATERIALS INDIA PVT LTD'});
    assert.equal(pending.services.length,count);
  }
});

test('service picker separates either applicant difference and prefers a closed PO', () => {
  const context = vm.createContext({ readAssignedServiceId: row => row.assignedServiceId });
  vm.runInContext(source.slice(source.indexOf('function clientMasterGroupingIdentity'), source.indexOf('function legacyServiceFingerprintCompatible')), context);
  vm.runInContext(source.slice(source.indexOf('function uniqueClientMasterServices'), source.indexOf('function activateAssignedService')), context);
  const base = { applicantType: 'PIBO', subApplicantType: 'Importer' };
  const rows = [
    {...base, assignedServiceId: 'open', _clientMasterEligible: false},
    {...base, applicantType: ' pibo ', subApplicantType: 'IMPORTER', assignedServiceId: 'closed', _clientMasterEligible: true},
    {...base, subApplicantType: 'Producer', assignedServiceId: 'producer'},
    {...base, applicantType: 'PWP', assignedServiceId: 'pwp'}
  ];
  assert.deepEqual(Array.from(context.uniqueClientMasterServices(rows), row => row.assignedServiceId), ['closed', 'producer', 'pwp']);
});
