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
