const test = require('node:test');
const assert = require('node:assert/strict');
const Quotation = require('../src/models/Quotation');
const pricing = require('../../shared/eprCreditPricing.cjs');
const { cleanItems, cleanBody } = require('../src/controllers/quotationController')._test;
const factory = require('../src/controllers/eprCreditController');
const api = factory({ quotationAccessFilter: async () => ({ createdBy: 'staff-id' }) });
const item = overrides => ({ id:'credit-1', businessCategory:'EPR Credit', servicesOffered:'Category 2 – Recycling', piboParent:'PWP', piboCategory:'PWP', unitLabel:'KG', creditRateBand:'below100', basicAmount:99, ...overrides });
const response = () => ({ code:200,status(value){this.code=value;return this;},json(body){this.body=body;return this;} });
test('all six credit services use the configured rates for both manual slabs',()=>{
 for(const [service,rates] of [['Category 1 – Recycling',[1.3,1.2]],['Category 1 – EOL',[1.3,1.2]],['Category 2 – Recycling',[2.4,2.4]],['Category 2 – EOL',[.95,.95]],['Category 3 – Recycling',[4.75,4.75]],['Category 3 – EOL',[.85,.85]]]) {
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
 assert.equal(cleanItems([{...original,servicesOffered:'Category 1 – EOL'}],null,[original])[0].basicAmount,1.3);
});
test('request submission preserves current prices; only Anand can apply the approved amount',async t=>{
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
 for(const user of [{email:'admin@example.test',role:'superadmin'},{email:'anand.padhya@ananttattva.com.evil.test'}]) {
  const denied=response();await api.decideCreditRateChange({params,user,body:{decision:'APPROVED'}},denied);assert.equal(denied.code,403);
 }
 const approved=response();await api.decideCreditRateChange({params,user:{email:'ANAND.PADHYA@ANANTTATTVA.COM'},body:{decision:'APPROVED'}},approved);
 assert.equal(approved.code,200);assert.equal(quote.items[0].basicAmount,1.85);assert.equal(quote.items[1].basicAmount,100);assert.equal(quote.grandTotal,101.85);assert.equal(quote.creditRateRequests[0].status,'APPROVED');
 const repeated=response();await api.decideCreditRateChange({params,user:{email:pricing.approverEmail},body:{decision:'APPROVED'}},repeated);assert.equal(repeated.code,409);
});
test('stale requests cannot apply to changed services and rejection leaves prices untouched',async t=>{
 const current=cleanItems([item()])[0];
 let quote={_id:'507f1f77bcf86cd799439011',updatedAt:new Date(),pricingMode:'individual',items:[{...current,servicesOffered:'Category 3 – EOL'}],creditRateRequests:[{id:'req',status:'PENDING',changes:[{itemIndex:0,basis:pricing.basis(current),currentAmount:2.4,requestedAmount:1.85}]}]};
 t.mock.method(Quotation,'findById',async()=>quote);
 t.mock.method(Quotation,'findOneAndUpdate',async(_filter,update)=>{Object.assign(quote,update.$set);return quote;});
 const req={params:{id:String(quote._id),requestId:'req'},user:{email:pricing.approverEmail},body:{decision:'APPROVED'}};
 const stale=response();await api.decideCreditRateChange(req,stale);assert.equal(stale.code,409);
 const rejected=response();await api.decideCreditRateChange({...req,body:{decision:'REJECTED'}},rejected);assert.equal(rejected.code,200);assert.equal(quote.items[0].basicAmount,2.4);assert.equal(quote.creditRateRequests[0].status,'REJECTED');
});
