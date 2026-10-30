const test=require('node:test');
const assert=require('node:assert/strict');
const {parseRevenuePaise}=require('../src/utils/revenueAmount');
test('browser and server agree on Indian formatting, leading zeros and decimal normalization',async()=>{
 const browser=(await import('../../frontend/src/utils/revenueAmount.mjs')).parseRevenuePaise;
 for(const [value,paise] of [['1,00,000',10000000],['₹ 1,00,000.00',10000000],['100,000.50',10000050],['0001000',100000],['1000.000',100000],['.50',50],['1000.',100000]]){
  assert.equal(parseRevenuePaise(value),paise);assert.equal(browser(value),paise);
 }
});
test('only explicit correction parsing permits zero; invalid and imprecise amounts stay blocked',async()=>{
 const browser=(await import('../../frontend/src/utils/revenueAmount.mjs')).parseRevenuePaise;
 assert.equal(parseRevenuePaise('0',{allowZero:true}),0);assert.equal(browser('0',{allowZero:true}),0);assert.throws(()=>parseRevenuePaise('0'));
 for(const value of ['-1','1e5','12,,345','1.001','NaN','Infinity','10000000000','']){assert.throws(()=>parseRevenuePaise(value,{allowZero:true}));assert.throws(()=>browser(value,{allowZero:true}));}
});
