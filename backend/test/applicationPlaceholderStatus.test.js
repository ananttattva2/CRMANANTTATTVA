const test=require('node:test');
const assert=require('node:assert/strict');
test('repeated unlinked annual assignments merge without losing years or distinct units and services',async()=>{
 const {effectiveApplicationServices}=await import('../../frontend/src/utils/applicationPortfolio.mjs');
 const first={id:'first',assignmentOnly:true,leadId:'khatri',category:'Producer',unit:'Unit 1',industry:'Manufacturing',eprCategory:'Plastic Waste',offeredServices:['Annual Return Filling'],bucket:'notStarted',closed:false,annualWorkflowReady:false,annualCurrentFyPo:false,annualYears:['2025-26']};
 const second={...first,id:'second',closed:true,annualWorkflowReady:true,annualCurrentFyPo:true,annualYears:['2026-27']};
 const result=effectiveApplicationServices([{...first},second]);
 assert.equal(result.length,1);
 assert.deepEqual(result[0].annualYears,['2025-26','2026-27']);
 assert.equal(result[0].closed,true);assert.equal(result[0].annualWorkflowReady,true);assert.equal(result[0].annualCurrentFyPo,true);
 for(const other of [{unit:'Unit 2'},{leadId:'another'},{category:'Importer'},{offeredServices:['New Registration']},{bucket:'approved'},{statusSourceClientId:'different-master'}]){
 assert.equal(effectiveApplicationServices([{...first},{...second,...other}]).length,2);
 }
 const saved=effectiveApplicationServices([{...first},{...second,assignmentOnly:false}]);
 assert.equal(saved.length,1);assert.equal(saved[0].id,'second');
});
test('service summaries keep registration in Not Started and only annual records in AR actions',async()=>{
 const {applicationServiceSummaryRecords,matchesStatusSummary,STATUS_COLUMNS}=await import('../../frontend/src/utils/applicationPortfolio.mjs');
 const registration={id:'registration',closed:true,offeredServices:['New Registration'],bucket:'notStarted',annual:false,clientStatus:'submitted'};
 const annual={id:'annual',closed:true,offeredServices:['Annual Return Filling'],bucket:'notStarted',annual:true,annualWorkflowReady:true};
 const rows=applicationServiceSummaryRecords({records:[{...registration,services:[registration,annual]}]});
 assert.equal(rows.length,2);
 const actions=rows.filter(row=>matchesStatusSummary(row,'annualActionRequired'));
 const notStarted=rows.filter(row=>matchesStatusSummary(row,'notStarted'));
 assert.equal(actions.length,1);assert.equal(notStarted.length,1);
 assert.deepEqual(actions[0].services.map(s=>s.offeredServices),[['Annual Return Filling']]);
 assert.deepEqual(notStarted[0].services.map(s=>s.offeredServices),[['New Registration']]);
 for(const row of rows) assert.equal(STATUS_COLUMNS.filter(([key])=>key!=='total'&&matchesStatusSummary(row,key)).length,1);
 assert.equal(new Set(rows.map(row=>row.id)).size,2);
 const open=applicationServiceSummaryRecords({records:[{...registration,services:[registration,{...annual,closed:false}]}]});
 assert.equal(open.filter(row=>matchesStatusSummary(row,'annualActionRequired')).length,1);
});
test('NUVIASHOP registration master retains annual sibling action in an exclusive status bucket',async()=>{
 const {applicationSummaryRecords,matchesStatusSummary,matchesServiceSummary,STATUS_COLUMNS}=await import('../../frontend/src/utils/applicationPortfolio.mjs');
 const registration={id:'registration',closed:true,offeredServices:['New Registration'],bucket:'notStarted',annual:false};
 const annual={id:'annual',closed:true,assignmentOnly:true,offeredServices:['Annual Return Filling'],bucket:'notStarted',annual:true,annualWorkflowReady:true,annualCurrentFyPo:true,annualYears:['2025-26']};
 const [summary]=applicationSummaryRecords({records:[{...registration,services:[registration,annual]}]});
 assert.equal(matchesStatusSummary(summary,'annualActionRequired'),true);
 assert.equal(matchesStatusSummary(summary,'notStarted'),false);
 assert.equal(matchesServiceSummary(summary,'annualActionRequired'),true);
 assert.deepEqual(STATUS_COLUMNS.filter(([key])=>key!=='total'&&matchesStatusSummary(summary,key)).map(([key])=>key),['annualActionRequired']);
 const [approved]=applicationSummaryRecords({records:[{...registration,services:[registration,{...annual,bucket:'approved'}]}]});
 assert.equal(matchesStatusSummary(approved,'annual:2025-26'),true);
 assert.equal(matchesStatusSummary(approved,'annualActionRequired'),false);
});
test('ASIA incomplete approved importer draft yields to submitted importer with a different industry',async()=>{
 const {effectiveApplicationServices}=await import('../../frontend/src/utils/applicationPortfolio.mjs');
 const importer={id:'importer',leadId:'asia',category:'Importer',unit:'Unit 1',industry:'Packaging Manufacture',eprCategory:'EPR - Plastic Waste',offeredServices:['Annual Return Filling'],clientStatus:'submitted',cpcb:'Approved'};
 const draft={...importer,id:'draft',unit:'',industry:'Manufacturing',offeredServices:[],clientStatus:'draft'};
 const producer={...importer,id:'producer',category:'Producer'};
 assert.deepEqual(effectiveApplicationServices([draft,producer,importer]).map(row=>row.id),['producer','importer']);
 assert.equal(effectiveApplicationServices([draft,producer]).length,2);
 assert.equal(effectiveApplicationServices([draft,{...importer,leadId:'other'}]).length,2);
 assert.equal(effectiveApplicationServices([{...draft,unit:'Unit 2'},importer]).length,2);
 assert.equal(effectiveApplicationServices([{...draft,offeredServices:['New Registration']},importer]).length,2);
 assert.equal(effectiveApplicationServices([{...draft,cpcb:'Under Review'},importer]).length,2);
});
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

test('multiple new assignments linked to one saved CPCB master show one service',async()=>{
 const {effectiveApplicationServices}=await import('../../frontend/src/utils/applicationPortfolio.mjs');
 const service={id:'assignment:new1',assignmentOnly:true,statusSourceClientId:'master',leadId:'lead',category:'Importer',unit:'Unit 1',industry:'Manufacturing',eprCategory:'Plastic Waste',offeredServices:['Annual Return Filling'],cpcb:'Approved',bucket:'approved',annualCurrentFyPo:false,annualYears:[]};
 const services=effectiveApplicationServices([service,{...service,id:'assignment:new2',annualCurrentFyPo:true,annualYears:['2025-26','2026-27']}]);
  assert.equal(services.length,1);assert.equal(services[0].cpcb,'Approved');assert.deepEqual(services[0].annualYears,['2025-26','2026-27']);
 assert.equal(services[0].annualCurrentFyPo,true);
 assert.equal(effectiveApplicationServices([service,{...service,id:'assignment:unit2',unit:'Unit 2'}]).length,2);
});
