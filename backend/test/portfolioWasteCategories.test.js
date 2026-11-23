const test=require('node:test'),assert=require('node:assert/strict');
test('waste categories isolate sibling services and their statuses without modifying the source',async()=>{
 const {portfolioWasteCategory,portfolioGroupsForWasteCategory}=await import('../../frontend/src/utils/portfolioWasteCategories.mjs');
 const {applicationReportGroups}=await import('../../frontend/src/utils/applicationPortfolio.mjs');
 for(const [label,expected]of [['EPR - Plastic Waste','plastic'],['Battery Waste Management','battery'],['EPR Batteries','battery'],['EPR - E-Waste','ewaste'],['Electronic Waste','ewaste'],['EPR - Used Oil','']])assert.equal(portfolioWasteCategory(label),expected);
 const service=(id,category,bucket)=>({id,eprCategory:category,bucket,closed:true,offeredServices:['Annual Return Filling'],annual:true,annualEligiblePo:true,annualWorkflowReady:true,annualYears:['2025-26'],category:'Producer'});
 const groups=[{id:'spoc',name:'SPOC',records:[{id:'company',services:[service('plastic','EPR - Plastic Waste','approved'),service('battery','EPR - Battery Waste','underReview')]}]}];
 const before=JSON.stringify(groups);
 const plastic=applicationReportGroups(portfolioGroupsForWasteCategory(groups,'plastic'))[0].records;
 const battery=applicationReportGroups(portfolioGroupsForWasteCategory(groups,'battery'))[0].records;
 assert.equal(plastic.length,1);assert.equal(plastic[0].bucket,'approved');assert.equal(battery.length,1);assert.equal(battery[0].bucket,'underReview');assert.equal(battery[0].services.length,1);assert.equal(JSON.stringify(groups),before);
});
