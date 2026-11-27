const test = require('node:test');
const assert = require('node:assert/strict');
const Quotation = require('../src/models/Quotation');
const pricing = require('../../shared/eprCreditPricing.cjs');
const { cleanItems, cleanBody } = require('../src/controllers/quotationController')._test;
const factory = require('../src/controllers/eprCreditController');
const api = factory({ quotationAccessFilter: async () => ({ createdBy: 'staff-id' }) });
const item = overrides => ({ id:'credit-1', businessCategory:'EPR Credit', servicesOffered:'Category 2 â€“ Recycling', piboParent:'PWP', piboCategory:'PWP', unitLabel:'KG', creditRateBand:'below100', basicAmount:99, ...overrides });
const response = () => ({ code:200,status(value){this.code=value;return this;},json(body){this.body=body;return this;} });
test('all six credit services use the configured rates for both manual slabs',()=>{
 for(const [service,rates] of [['Category 1 â€“ Recycling',[1.3,1.2]],['Category 1 â€“ EOL',[1.3,1.2]],['Category 2 â€“ Recycling',[2.4,2.4]],['Category 2 â€“ EOL',[.95,.95]],['Category 3 â€“ Recycling',[4.75,4.75]],['Category 3 â€“ EOL',[.85,.85]]]) {
  for(const [index,band] of ['below100','above100'].entries()) assert.equal(pricing.rate(item({servicesOffered:service,creditRateBand:band})),rates[index]);
 }
});
test('server ignores manually supplied rates and forged approvals; normal consultancy remains editable',()=>{
 const credit=item({creditRateApproval:{basis:pricing.basis(item()),rate:.01}});
 assert.equal(cleanItems([credit])[0].basicAmount,2.4);
 assert.equal(cleanItems([credit])[0].creditRateApproval,undefined);
 assert.equal(cleanItems([{businessCategory:'EPR Consultancy',servicesOffered:'Annual Return Filling',periodUnit:'annual',servicePeriod:1,basicAmount:456}])[0].basicAmount,456);
 assert.throws(()=>cleanItems([item({creditRateBand:'fake'})]),/valid Expected Target/);
 assert.throws(()=>cleanBody({items:[item()],pricingMode:'combined'}),/individual pricing/);
 const result=cleanBody({items:[item()],subtotal:1,grandTotal:1});assert.equal(result.subtotal,2.4);assert.equal(result.grandTotal,2.4);
});
test('only trusted stored approvals for exactly the same item and slab survive editing',()=>{
 const original=cleanItems([item()])[0];original.creditRateApproval={basis:pricing.basis(original),rate:1.85,requestId:'approved-request'};
 assert.equal(cleanItems([{...original,basicAmount:9}],null,[original])[0].basicAmount,1.85);
 assert.equal(cleanItems([{...original,creditRateBand:'above100'}],null,[original])[0].basicAmount,2.4);
 assert.equal(cleanItems([{...original,servicesOffered:'Category 1 â€“ EOL'}],null,[original])[0].basicAmount,1.3);
});
test('request submission preserves prices until the designated approver approves',async t=>{
 let quote=Quotation.hydrate({_id:'507f1f77bcf86cd799439011',updatedAt:new Date('2026-01-01'),pricingMode:'individual',items:[cleanItems([item()])[0],{id:'normal',businessCategory:'EPR Consultancy',basicAmount:100,unit:'1'}],creditRateRequests:[]});
 t.mock.method(Quotation,'findOne',async filter=>{assert.equal(filter.$and[1].createdBy,'staff-id');return quote;});
 t.mock.method(Quotation,'findById',async()=>quote);
 t.mock.method(Quotation,'findOneAndUpdate',async(filter,update)=>{
  assert.equal(+filter.updatedAt,+quote.updatedAt);
  if(update.$push) quote.creditRateRequests.push(update.$push.creditRateRequests);
  if(update.$set) Object.assign(quote,update.$set);
  quote.updatedAt=new Date(+quote.updatedAt+1);return quote;
 });
 const res=response();await api.requestCreditRateChange({params:{id:String(quote._id)},user:{_id:'staff-id',email:'staff@example.test'},body:{changes:[{itemIndex:0,requestedAmount:1.85}]}},res);
 assert.equal(res.code,201);assert.equal(quote.items[0].basicAmount,2.4);
 const requestId=res.body.request.id;
 const params={id:String(quote._id),requestId};
 for(const user of [{email:'admin@example.test',role:'admin'},{email:'anand.padhya@ananttattva.com.evil.test'}]) {
  const denied=response();await api.decideCreditRateChange({params,user,body:{decision:'APPROVED'}},denied);assert.equal(denied.code,403);
 }
 const approved=response();await api.decideCreditRateChange({params,user:{email:'ANAND.PADHYA@ANANTTATTVA.COM'},body:{decision:'APPROVED',useRequestedAmounts:true}},approved);
 assert.equal(approved.code,200);assert.equal(quote.items[0].basicAmount,1.85);assert.equal(quote.items[1].basicAmount,100);assert.equal(quote.grandTotal,101.85);assert.equal(quote.creditRateRequests[0].status,'APPROVED');
 const repeated=response();await api.decideCreditRateChange({params,user:{email:pricing.approverEmail},body:{decision:'APPROVED'}},repeated);assert.equal(repeated.code,409);
});
test('EPR Credit list grants decision access to Super Admin and the designated approver', async t => {
 const filters = [];
 const chain = { select: () => chain, sort: () => chain, limit: () => chain, lean: async () => [] };
 t.mock.method(Quotation, 'find', filter => { filters.push(filter); return chain; });
 for (const [user, allowed] of [
  [{ email: 'super@example.test', role: 'superadmin' }, true],
  [{ email: 'multi@example.test', role: 'admin', roles: ['Super Admin'] }, true],
  [{ email: pricing.approverEmail, role: 'sales' }, true],
  [{ email: 'admin@example.test', role: 'admin' }, false]
 ]) {
  const res = response();
  await api.listCreditRateRequests({ user }, res);
  assert.equal(res.body.canDecide, allowed);
  assert.deepEqual(filters.at(-1).$and[0], allowed ? {} : { createdBy: 'staff-id' });
 }
});
test('stale requests cannot apply to changed services and rejection leaves prices untouched',async t=>{
 const current=cleanItems([item()])[0];
 let quote={_id:'507f1f77bcf86cd799439011',updatedAt:new Date(),pricingMode:'individual',items:[{...current,servicesOffered:'Category 3 â€“ EOL'}],creditRateRequests:[{id:'req',status:'PENDING',changes:[{itemIndex:0,basis:pricing.basis(current),currentAmount:2.4,requestedAmount:1.85}]}]};
 t.mock.method(Quotation,'findById',async()=>quote);
 t.mock.method(Quotation,'findOneAndUpdate',async(_filter,update)=>{Object.assign(quote,update.$set);return quote;});
 const req={params:{id:String(quote._id),requestId:'req'},user:{email:pricing.approverEmail},body:{decision:'APPROVED'}};
 const stale=response();await api.decideCreditRateChange(req,stale);assert.equal(stale.code,409);
 const rejected=response();await api.decideCreditRateChange({...req,body:{decision:'REJECTED'}},rejected);assert.equal(rejected.code,200);assert.equal(quote.items[0].basicAmount,2.4);assert.equal(quote.creditRateRequests[0].status,'REJECTED');
});


test('Super Admin can apply final amounts, with the reviewer recorded on the request and each item',async t=>{
 const first=cleanItems([item({servicesOffered:'Category 1 – Recycling'})])[0];
 const second=cleanItems([item({id:'credit-2',servicesOffered:'Category 2 – EOL'})])[0];
 let quote=Quotation.hydrate({_id:'507f1f77bcf86cd799439011',updatedAt:new Date(),pricingMode:'individual',items:[first,second],creditRateRequests:[{id:'final-request',status:'PENDING',changes:[{itemIndex:0,item:first,basis:pricing.basis(first),currentAmount:1.3,requestedAmount:10},{itemIndex:1,item:second,basis:pricing.basis(second),currentAmount:.95,requestedAmount:2.8}]}]});
 t.mock.method(Quotation,'findById',async()=>quote);
 t.mock.method(Quotation,'findOneAndUpdate',async(_filter,update)=>{Object.assign(quote,update.$set);return quote;});
 const req={params:{id:String(quote._id),requestId:'final-request'},user:{email:'super@example.test',role:'superadmin'},body:{decision:'APPROVED',finalAmounts:[{itemIndex:0,amount:11},{itemIndex:1,amount:2.90}]}};
 const approved=response();await api.decideCreditRateChange(req,approved);assert.equal(approved.code,200);
 assert.equal(approved.body.quotation.items[0].basicAmount,11);assert.equal(approved.body.quotation.items[1].basicAmount,2.9);assert.equal(quote.grandTotal,13.9);
 assert.equal(approved.body.request.decidedBy, req.user.email);
 assert.ok(quote.items.every(item => item.creditRateApproval.approvedBy === req.user.email));
 assert.equal(quote.creditRateRequests[0].changes[0].requestedAmount,10);assert.equal(quote.creditRateRequests[0].changes[0].finalAmount,11);assert.equal(quote.creditRateRequests[0].changes[1].finalAmount,2.9);
 const saved=quote.items.map(value=>value.toObject());const edited=cleanItems(saved,null,saved);assert.equal(edited[0].basicAmount,11);assert.equal(edited[1].basicAmount,2.9);
 const{buildQuotationPrintHtml}=await import('../../frontend/src/utils/quotationDocument.mjs');const html=buildQuotationPrintHtml(quote.toObject());assert.match(html,/11\.00/);assert.match(html,/2\.90/);
});
test('blank final amounts require explicit fallback consent and only blank rows use requested rates',()=>{
 const{finalAmountsFor}=factory._test;const request={changes:[{itemIndex:0,requestedAmount:10},{itemIndex:1,requestedAmount:2.8}]};
 assert.throws(()=>finalAmountsFor(request,{}),/Confirm whether/);
 assert.throws(()=>finalAmountsFor(request,{finalAmounts:[{itemIndex:0,amount:11}]}),/Confirm whether/);
 assert.deepEqual(finalAmountsFor(request,{finalAmounts:[{itemIndex:0,amount:11}],useRequestedAmounts:true}),[{itemIndex:0,amount:11,source:'approver'},{itemIndex:1,amount:2.8,source:'requested'}]);
 assert.deepEqual(finalAmountsFor(request,{finalAmounts:[{itemIndex:0,amount:0},{itemIndex:1,amount:2.9}]}).map(value=>value.amount),[0,2.9]);
 for(const value of [-1,'NaN',true,{},1e10])assert.throws(()=>finalAmountsFor(request,{finalAmounts:[{itemIndex:0,amount:value}],useRequestedAmounts:true}),/valid non-negative/);
 assert.throws(()=>finalAmountsFor(request,{finalAmounts:[{itemIndex:9,amount:2}],useRequestedAmounts:true}),/valid, unique/);
});
test('approval API refuses omitted final amounts without explicit confirmation and rejects forged finals from other users',async t=>{
 const current=cleanItems([item()])[0];const quote=Quotation.hydrate({_id:'507f1f77bcf86cd799439011',updatedAt:new Date(),pricingMode:'individual',items:[current],creditRateRequests:[{id:'req',status:'PENDING',changes:[{itemIndex:0,basis:pricing.basis(current),currentAmount:2.4,requestedAmount:3}]}]});
 t.mock.method(Quotation,'findById',async()=>quote);t.mock.method(Quotation,'findOneAndUpdate',()=>{throw new Error('Must not write without approval consent.');});
 const req={params:{id:String(quote._id),requestId:'req'},user:{email:pricing.approverEmail},body:{decision:'APPROVED'}};
 const missing=response();await api.decideCreditRateChange(req,missing);assert.equal(missing.code,400);assert.equal(missing.body.requiresRequestedAmountConfirmation,true);assert.equal(quote.items[0].basicAmount,2.4);
 const denied=response();await api.decideCreditRateChange({...req,user:{email:'admin@example.test',role:'admin'},body:{decision:'APPROVED',finalAmounts:[{itemIndex:0,amount:11}]}},denied);assert.equal(denied.code,403);
});
