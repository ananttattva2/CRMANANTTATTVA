const test = require('node:test');
const assert = require('node:assert/strict');
const Client = require('../src/models/Client');
const Lead = require('../src/models/Lead');
const controller = require('../src/controllers/clientController');
const { requireRoles } = require('../src/middleware/auth');
const { CLIENT_APPROVAL_ROLES } = require('../src/constants/roles');
const id = '507f1f77bcf86cd799439011';
function response() { return { statusCode:200, status(n){this.statusCode=n;return this}, json(data){this.data=data;return this} }; }

test('compliance reviewers discover applicant Client Masters owned by other staff', async () => {
  const originalOne=Client.findOne, originalFind=Client.collection.find;
  const record={_id:id,companyIdentity:'reconfoods',data:{basic:{clientLegalName:'RECON FOODS PVT LTD',piboCategory:'Brand Owner',eprCategory:'EPR - Plastic Waste'}}};
  const filters=[];
  Client.findOne=(filter)=>{filters.push(filter);return {select(){return this},async lean(){return record}}};
  Client.collection.find=(filter)=>{filters.push(filter);return {sort(){return this},async toArray(){return [record]}}};
  try {
    for(const user of [{role:'compliance'}, {role:'sales',roles:['compliance']}, {role:'compliance-manager'}, {role:'admin'}]) {
      const res=response();
      await controller.listClientReviewApplicants({params:{id},query:{identity:'client:ignored'},user},res);
      assert.equal(res.statusCode,200);
      assert.equal(res.data.services.length,1);
      assert.equal(res.data.services[0].clientMasterId,id);
    }
    assert.deepEqual(filters[0],{_id:id});
    assert.ok(filters.every(filter=>!JSON.stringify(filter).includes('createdBy')));
  } finally {Client.findOne=originalOne;Client.collection.find=originalFind;}
});

test('ordinary staff cannot use reviewer applicant discovery', async () => {
  for(const role of ['sales','operation','manager','accounts']) {
    const res=response();
    await controller.listClientReviewApplicants({params:{id},user:{role}},res);
    assert.equal(res.statusCode,403);
    let passed=false;
    requireRoles(CLIENT_APPROVAL_ROLES)({user:{role}},res,()=>{passed=true});
    assert.equal(passed,false);
  }
});

test('compliance applicant discovery collapses duplicate documents for the same logical service', async () => {
  const duplicateId = '507f1f77bcf86cd799439012';
  const originalOne=Client.findOne, originalFind=Client.collection.find;
  const makeRecord = (recordId, assignedServiceId) => ({
    _id: recordId,
    assignedServiceId,
    workflowStatus: 'submitted',
    companyIdentity: 'manglamplasticspvtltd',
    data: {
      assignedServiceId,
      basic: { clientLegalName:'MANGLAM PLASTICS PVT LTD', piboCategory:'Producer', eprCategory:'EPR - Plastic Waste', servicesOffered:'Annual Return Filling' },
      selectedLeadSnapshot: { applicantType:'PIBO', plantUnit:'Unit 1' }
    }
  });
  const preferred = makeRecord(id, 'producer-original');
  const duplicate = makeRecord(duplicateId, 'producer-duplicate');
  Client.findOne=()=>({select(){return this},async lean(){return preferred}});
  Client.collection.find=()=>({sort(){return this},async toArray(){return [duplicate, preferred]}});
  try {
    const res=response();
    await controller.listClientReviewApplicants({params:{id},user:{role:'compliance'}},res);
    assert.equal(res.statusCode,200);
    assert.equal(res.data.services.length,1);
    assert.equal(res.data.services[0].clientMasterId,id);
    assert.equal(res.data.services[0].assignedServiceId,'producer-original');
  } finally {Client.findOne=originalOne;Client.collection.find=originalFind;}
});

test('compliance applicant discovery restores a missing service name from the matching Lead service', async () => {
  const leadId = '507f1f77bcf86cd799439099';
  const originalClientOne = Client.findOne;
  const originalClientFind = Client.collection.find;
  const originalLeadOne = Lead.findOne;
  const record = {
    _id: id,
    selectedLead: leadId,
    assignedServiceId: 'producer-registration',
    workflowStatus: 'submitted',
    companyIdentity: 'dharmajcropguardlimited',
    data: {
      assignedServiceId: 'producer-registration',
      basic: { clientLegalName: 'DHARMAJ CROP GUARD LIMITED', piboCategory: 'Producer', eprCategory: 'EPR - Plastic Waste', servicesOffered: '' },
      selectedLeadSnapshot: { applicantType: 'PIBO', plantUnit: 'Unit 1' }
    }
  };
  Client.findOne = () => ({ select() { return this; }, async lean() { return record; } });
  Client.collection.find = () => ({ sort() { return this; }, async toArray() { return [record]; } });
  Lead.findOne = (filter) => ({
    select() { return this; },
    async lean() {
      assert.equal(String(filter._id), leadId);
      return {
        _id: leadId,
        leadCode: 'ATPL-LEAD-0227',
        company: 'DHARMAJ CROP GUARD LIMITED',
        serviceSelections: [
          { assignedServiceId: 'producer-registration', subApplicantType: 'Producer', servicesOffered: 'New Registration' },
          { assignedServiceId: 'brand-owner-annual', subApplicantType: 'Brand Owner', servicesOffered: 'Annual Return Filling' }
        ]
      };
    }
  });
  try {
    const res = response();
    await controller.listClientReviewApplicants({ params: { id }, user: { role: 'compliance' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.data.services.length, 1);
    assert.equal(res.data.services[0].piboCategory, 'Producer');
    assert.equal(res.data.services[0].servicesOffered, 'New Registration');
  } finally {
    Client.findOne = originalClientOne;
    Client.collection.find = originalClientFind;
    Lead.findOne = originalLeadOne;
  }
});
