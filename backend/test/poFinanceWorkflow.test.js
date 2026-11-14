const {test}=require('node:test');const assert=require('node:assert/strict');
const {transition,sourceSignature,termsSnapshot}=require('../src/services/poApprovalWorkflow');
const actor=role=>({_id:'507f1f77bcf86cd799439011',name:role,role});
test('PO requires Admin → Finance referral/freeze → Super Admin Go Ahead → Finance final decision',()=>{
 const initial=transition(null,'ADMIN_APPROVE',actor('admin'),'Initial review');assert.equal(initial.stage,'FINANCE_READY');assert.equal(initial.frozen,false);
 const direct=transition(initial,'FINANCE_APPROVE',actor('accounts'),'Finance approved directly',1);assert.equal(direct.stage,'FINALIZED');assert.equal(direct.frozen,false);assert.equal(direct.financeFinal.remarks,'Finance approved directly');
 const secondaryFinance=transition(initial,'FINANCE_APPROVE',{...actor('admin'),roles:['admin','finance']},'Secondary Finance role approved',1);assert.equal(secondaryFinance.stage,'FINALIZED');
 assert.throws(()=>transition(initial,'FINANCE_APPROVE',actor('admin'),'Approve',1),error=>error.status===403);
 assert.throws(()=>transition(initial,'FINANCE_FINAL',actor('accounts'),'Final',1),error=>error.status===409);
 assert.throws(()=>transition(initial,'FINANCE_REFER',actor('admin'),'Refer',1),error=>error.status===403);
 const referred=transition(initial,'FINANCE_REFER',actor('accounts'),'Finance remarks',1);assert.equal(referred.stage,'MANAGEMENT_PENDING');assert.equal(referred.frozen,true);
 for(const role of ['admin','manager','accounts','sales'])assert.throws(()=>transition(referred,'MANAGEMENT_GO_AHEAD',actor(role),'Go Ahead',2),error=>error.status===403);
 assert.throws(()=>transition(referred,'FINANCE_FINAL',actor('accounts'),'Approve',2),error=>error.status===409);
 const released=transition(referred,'MANAGEMENT_GO_AHEAD',actor('superadmin'),'Reviewed Finance remarks',2);assert.equal(released.frozen,false);assert.equal(released.stage,'FINANCE_RELEASED');assert.equal(released.financeReferral.remarks,'Finance remarks');
 assert.throws(()=>transition(released,'FINANCE_FINAL',actor('admin'),'Approve',3),error=>error.status===403);
 assert.throws(()=>transition(released,'FINANCE_FINAL',actor('accounts'),'Approve',2),error=>error.status===409);
 const final=transition(released,'FINANCE_FINAL',actor('accounts'),'Final approval',3);assert.equal(final.stage,'FINALIZED');assert.equal(final.history.length,4);
 assert.throws(()=>transition(final,'FINANCE_FINAL',actor('accounts'),'Replay',3),error=>error.status===409);
 assert.throws(()=>transition(initial,'FINANCE_REFER',actor('accounts'),' ',1),error=>error.status===400);
});
test('review signature detects PO, proof, terms and service changes and ignores object key order',()=>{
 const row={poStatus:'received',poYearRows:[{poNumber:'PO-1',poAmount:100,paymentTerm:'100% advance',poFileUrl:'https://example.test/po.pdf'}]};
 const hash=sourceSignature(row,{eprCategory:'Plastic'});
 assert.equal(hash,sourceSignature({poYearRows:[{poFileUrl:'https://example.test/po.pdf',paymentTerm:'100% advance',poAmount:100,poNumber:'PO-1'}],poStatus:'received'},{eprCategory:'Plastic'}));
 assert.notEqual(hash,sourceSignature({...row,poYearRows:[{...row.poYearRows[0],poAmount:200}]},{eprCategory:'Plastic'}));
 assert.notEqual(hash,sourceSignature(row,{eprCategory:'Battery'}));
 assert.notEqual(hash,sourceSignature({...row,poYearRows:[{...row.poYearRows[0],paymentTerm:'50% advance'}]},{eprCategory:'Plastic'}));
});
test('finance terms retain the user-selected payment term and every custom quotation term',()=>{
 const terms=termsSnapshot([{poNumber:'PO-1',quotationId:'quote',paymentTerm:'50% advance'}],[{_id:'quote',quotationNumber:'AT/1',paymentTerm:'100% advance',terms:['Custom delivery term','Custom tax term']}]);
 assert.equal(terms[0].paymentTerm,'50% advance');assert.deepEqual(terms[0].customTerms,['Custom delivery term','Custom tax term']);assert.equal(terms[0].quotationNumber,'AT/1');
});

test('saved quotation ID takes priority over another quotation with the same display number',()=>{
 const terms=termsSnapshot([{poNumber:'PO-2',quotationId:'selected',quotationNumber:'AT/1'}],[{_id:'other',quotationNumber:'AT/1',terms:['Wrong version']},{_id:'selected',quotationNumber:'AT/1',terms:['Selected version']}]);
 assert.deepEqual(terms[0].customTerms,['Selected version']);
});
