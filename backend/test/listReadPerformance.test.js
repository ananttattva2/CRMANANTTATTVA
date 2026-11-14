const test = require('node:test');
const assert = require('node:assert/strict');
const Quotation = require('../src/models/Quotation');
const controller = require('../src/controllers/quotationController');
test('quotation directory fetches list fields only, retaining scoped totals and detail hydration marker', async () => {
 const originalFind=Quotation.find, originalCount=Quotation.countDocuments; let selected, filter;
 const query={select(value){selected=value;return this;},sort(){return this;},populate(){throw Error('Directory must not populate unused detail actors');},async lean(){return [{_id:'q1',items:[{basicAmount:120}],status:'approved'}];}};
 Quotation.find=value=>{filter=value;return query;}; Quotation.countDocuments=async()=>1;
 try { let result;await controller.listQuotations({query:{view:'directory'},user:{role:'admin'}},{json(value){result=value;}});
 assert.ok(selected.includes('items.basicAmount'));assert.ok(!selected.split(' ').includes('items'));assert.ok(!selected.includes('revisionHistory'));assert.ok(!selected.includes('scopeOfWork'));assert.equal(result.quotations[0]._listOnly,true);assert.equal(result.pagination.total,1);assert.ok(filter);
 }finally{Quotation.find=originalFind;Quotation.countDocuments=originalCount;}
});
