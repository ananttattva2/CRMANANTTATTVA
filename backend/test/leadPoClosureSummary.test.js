const test=require('node:test');const assert=require('node:assert/strict');
const {serviceClosureSummary}=require('../../shared/leadPoClosure.cjs');const{closedPoClientFilter}=require('../src/services/clientClosedPoDirectory');
const closed=id=>({assignedServiceId:id,closedAt:'2026-01-01',poStatus:'received',poApprovalStatus:'APPROVED',poYearRows:[{poNumber:'PO-'+id}]});
const mixed=()=>({serviceSelections:['a','b','c','d','e'].map(assignedServiceId=>({assignedServiceId})),assignments:[closed('b'),{assignedServiceId:'d'},closed('a'),{assignedServiceId:'c'},{assignedServiceId:'e'}],closedByText:'Root closer'});
test('five services with reordered assignments report two closed and three not closed',()=>{assert.deepEqual(serviceClosureSummary(mixed()),{total:5,closedCount:2,openCount:3});});
test('PO and closure on different services never close a lead; pending and rejected approvals stay open',()=>{
 const lead=mixed();lead.assignments=[{assignedServiceId:'a',closedAt:'2026-01-01'},{assignedServiceId:'b',poYearRows:[{poNumber:'B'}]}, {...closed('c'),poApprovalStatus:'PENDING'},{...closed('d'),poApprovalStatus:'REJECTED'},{assignedServiceId:'e'}];assert.equal(serviceClosureSummary(lead).closedCount,0);
});
test('legacy single-service closure with PO evidence is supported but root closure never spills to siblings',()=>{
 assert.equal(serviceClosureSummary({closedByText:'Legacy closer',poYearRows:[{poNumber:'PO'}]}).closedCount,1);
 assert.equal(serviceClosureSummary({closedAt:'2026-01-01',serviceSelections:[{assignedServiceId:'a'}],assignments:[{assignedServiceId:'a',poStatus:'received'}]}).closedCount,1);
 assert.equal(serviceClosureSummary({closedAt:'2026-01-01',serviceSelections:[{assignedServiceId:'a'},{assignedServiceId:'b'}],assignments:[{assignedServiceId:'a',poStatus:'received'},{assignedServiceId:'b',poStatus:'received'}]}).closedCount,0);
});
test('Client Master database filter excludes companies with no closed PO before pagination',async()=>{
 const result=await closedPoClientFilter({find:()=>({select(){return this;},lean:async()=>[{_id:'eligible',leadCode:'CLOSED',...mixed()},{_id:'open',leadCode:'OPEN',serviceSelections:[{}],assignments:[{poStatus:'received'}]},{_id:'no-po',leadCode:'NO-PO',closedAt:'2026-01-01'}]})});
 assert.deepEqual(result.$or[0].selectedLead.$in,['eligible']);assert.deepEqual(result.$or.find(row=>row['data.importMeta.leadNumber'])['data.importMeta.leadNumber'].$in,['CLOSED']);
});

test('legacy multi-service assignments are counted even without a serviceSelections array',()=>{
 assert.deepEqual(serviceClosureSummary({assignments:[closed('a'),closed('b'),{assignedServiceId:'c'}]}),{total:3,closedCount:2,openCount:1});
});
