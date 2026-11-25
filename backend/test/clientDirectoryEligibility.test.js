const test=require('node:test');const assert=require('node:assert/strict');
const{clientDirectoryEligibilityFilter}=require('../src/services/clientDirectoryEligibility');
test('both directories retain legacy closed-PO clients and saved Client Master data',async()=>{
 const closed={selectedLead:{$in:['legacy-closed']}};
 const filter=await clientDirectoryEligibilityFilter({closedPoFilter:async()=>closed});
 assert.deepEqual(filter.$or[0],closed);
 assert.ok(filter.$or.some(branch=>branch.workflowStatus==='submitted'));
 assert.ok(filter.$or.some(branch=>branch['data.cte.plantWiseDetails.0']));
 assert.ok(!JSON.stringify(filter).includes('FINALIZED'));
});
const fs=require('node:fs');const path=require('node:path');
test('Client Master and Approval Center use the identical visibility rule',()=>{
 const source=fs.readFileSync(path.resolve(__dirname,'../src/controllers/clientController.js'),'utf8');
 assert.equal(source.split("require('../services/clientDirectoryEligibility').clientDirectoryEligibilityFilter()").length-1,2);
 assert.ok(!source.includes("require('../services/financeApprovedClients').financeApprovedClientFilter()"));
});
