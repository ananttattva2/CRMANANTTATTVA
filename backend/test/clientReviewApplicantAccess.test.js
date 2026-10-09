const test = require('node:test');
const assert = require('node:assert/strict');
const Client = require('../src/models/Client');
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
