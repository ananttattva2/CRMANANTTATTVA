const test=require('node:test');
const assert=require('node:assert/strict');
test('matching annual assignment placeholder uses one saved Client Master status',async()=>{
 const {effectiveApplicationServices,applicationSummaryRecords,STATUS_COLUMNS}=await import('../../frontend/src/utils/applicationPortfolio.mjs');
 const saved={id:'master',leadId:'lead',assignmentOnly:false,category:'Producer',unit:'Unit 1',industry:'Consumer Goods',eprCategory:'Plastic Waste',offeredServices:['Annual Return Filling'],annualYears:['2025-26'],bucket:'approved',closed:true,annual:true,annualWorkflowReady:true};
 const placeholder={...saved,id:'assignment:lead:2',assignmentOnly:true,bucket:'notStarted',annualYears:['2026-27']};
 const services=effectiveApplicationServices([saved,placeholder]);
 assert.equal(services.length,1);
 assert.deepEqual(services[0].annualYears,['2025-26','2026-27']);
 const [summary]=applicationSummaryRecords({records:[{...saved,services}]});
 assert.equal(summary.bucket,'approved');
 assert.equal(STATUS_COLUMNS.some(([key])=>key==='approved'),false);
 assert.equal(effectiveApplicationServices([saved,{...placeholder,unit:'Unit 2'}]).length,2);
 assert.equal(effectiveApplicationServices([saved,{...placeholder,assignmentOnly:false}]).length,2);
 assert.equal(effectiveApplicationServices([saved,{...placeholder,offeredServices:['New Registration']}]).length,2);
});

test('blank duplicate drafts use the submitted master across clients without hiding distinct records', async()=>{
 const {effectiveApplicationServices,applicationSummaryRecords}=await import('../../frontend/src/utils/applicationPortfolio.mjs');
 for(const name of ['MANGLAM PLASTICS PVT LTD','Another Client']) {
  const master={id:'submitted',name,leadId:'lead',category:'Producer',unit:'Unit 1',industry:'Manufacturing',eprCategory:'Plastic Waste',offeredServices:['Annual Return Filling'],clientStatus:'submitted',cpcb:'Approved',bucket:'approved',closed:true,annualWorkflowReady:true};
  const draft={...master,id:'draft',clientStatus:'draft',cpcb:'Not recorded',bucket:'notStarted'};
  const services=effectiveApplicationServices([draft,master]);
  assert.equal(services.length,1);
  assert.equal(applicationSummaryRecords({records:[{...master,services}]})[0].bucket,'approved');
  assert.equal(effectiveApplicationServices([master,{...draft,cpcb:'Under Review',bucket:'underReview'}]).length,2);
  assert.equal(effectiveApplicationServices([master,{...draft,unit:'Unit 2'}]).length,2);
  assert.equal(effectiveApplicationServices([master,{...draft,leadId:'another-lead'}]).length,2);
  assert.equal(effectiveApplicationServices([draft]).length,1);
 }
});

test('summary CPCB status excludes other offered services but retains all units and detail records',async()=>{
 const {applicationSummaryRecords}=await import('../../frontend/src/utils/applicationPortfolio.mjs');
 const annual={id:'unit1',closed:true,offeredServices:['Annual Return Filling'],bucket:'approved',annual:true,annualWorkflowReady:true};
 const unit2={...annual,id:'unit2'};
 const credit={...annual,id:'credit',offeredServices:['Credit Procurement'],bucket:'notStarted',annual:false};
 for(const name of ['APEX PACKING PRODUCTS PVT LTD','Another Client']) {
  const group={records:[{...annual,name,services:[annual,unit2,credit]}]};
  const [summary]=applicationSummaryRecords(group);
  assert.equal(summary.bucket,'approved');assert.equal(summary.services.length,3);
  unit2.bucket='notStarted';assert.equal(applicationSummaryRecords(group)[0].bucket,'notStarted');
  unit2.bucket='approved';credit.bucket='rejected';assert.equal(applicationSummaryRecords(group)[0].bucket,'approved');
 }
});
