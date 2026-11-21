const test=require('node:test');const assert=require('node:assert/strict');const mongoose=require('mongoose');
const Quotation=require('../src/models/Quotation');const Lead=require('../src/models/Lead');const User=require('../src/models/User');const Delivery=require('../src/models/ReminderDelivery');const mailer=require('../src/utils/mailer');
const service=require('../src/services/approvedQuotationPoReminders');const{WEEK,openServices,recipientUsers,emailHtml}=service.__test;
const quoteId='507f1f77bcf86cd799439011';const leadId='507f1f77bcf86cd799439012';const salesId='507f1f77bcf86cd799439013';const staffId='507f1f77bcf86cd799439014';
const query=data=>({select(){return this;},lean:async()=>typeof data==='function'?data():data});
const fixture=()=>({quote:{_id:quoteId,status:'approved',quotationNumber:'AT/26-27/501',leadRef:leadId,createdBy:new mongoose.Types.ObjectId(staffId),companyName:'Example Ltd',managementApproval:{actionAt:new Date('2026-01-01T00:00:00Z')},createdAt:new Date('2025-01-01'),items:['a','b','c'].map(assignedServiceId=>({assignedServiceId,servicesOffered:'Service '+assignedServiceId,piboCategory:'Importer'}))},lead:{_id:leadId,leadCode:'ATPL-1',createdBy:salesId,assignedStaff:staffId,serviceSelections:['a','b','c'].map(assignedServiceId=>({assignedServiceId})),assignments:['a','b','c'].map(assignedServiceId=>({assignedServiceId,assignedTo:staffId}))},users:[{_id:salesId,email:'sales@example.test',name:'Sales owner',role:'sales'},{_id:staffId,email:'staff@example.test',name:'Staff',role:'operation'},{_id:'admin',email:'admin@example.test',role:'operation',roles:['operation','admin']},{_id:'super',email:'super@example.test',role:'superadmin'},{_id:'other',email:'other-sales@example.test',role:'sales'},{_id:'inactive',email:'inactive@example.test',role:'admin',isActive:false}]});
const close=(assignment,quotationId=quoteId)=>Object.assign(assignment,{closedAt:'2026-01-02',poApprovalStatus:'APPROVED',poStatus:'received',poYearRows:[{poNumber:'PO',quotationId}]});
function setup(t,f,{failEmail,closeBeforeSend}={}){
 const ledger=new Map();const sent=[];let sequence=0;
 t.mock.method(Quotation,'find',()=>query([f.quote]));t.mock.method(Quotation,'findById',()=>query(()=>{if(closeBeforeSend)f.lead.assignments.forEach(row=>close(row));return f.quote;}));
 t.mock.method(Lead,'find',()=>query([f.lead]));t.mock.method(Lead,'findOne',()=>query(f.lead));t.mock.method(User,'find',()=>query(f.users));
 t.mock.method(Delivery,'create',async row=>{if(ledger.has(row.key))throw Object.assign(new Error('duplicate'),{code:11000});const result={...row,_id:String(++sequence)};ledger.set(row.key,result);return result;});
 t.mock.method(Delivery,'findOneAndUpdate',async(filter,update)=>{const row=ledger.get(filter.key);if(!row||row.status!=='sending'||+row.leaseUntil>+filter.leaseUntil.$lte)return null;Object.assign(row,update.$set);return row;});
 t.mock.method(Delivery,'updateOne',async(filter,update)=>{const row=[...ledger.values()].find(row=>row._id===filter._id);if(row)Object.assign(row,update.$set);return {};});
 t.mock.method(Delivery,'deleteOne',async filter=>{for(const[key,row]of ledger)if(row._id===filter._id)ledger.delete(key);return {};});
 t.mock.method(mailer,'sendMail',async(email,subject,html)=>{if(failEmail?.(email))throw Object.assign(new Error('offline'),{code:'TEST_MAIL_OFFLINE'});sent.push({email,subject,html});return {};});
 return{sent,ledger};
}
test('each quoted service is checked independently; unrelated quotation PO cannot stop reminders',()=>{
 const f=fixture();close(f.lead.assignments[0]);assert.deepEqual(openServices(f.quote,f.lead).map(row=>row.item.assignedServiceId),['b','c']);
 close(f.lead.assignments[1],'other-quotation');assert.equal(openServices(f.quote,f.lead).length,2);
 f.lead.assignments.reverse();assert.deepEqual(openServices(f.quote,f.lead).map(row=>row.item.assignedServiceId),['b','c']);
 assert.equal(openServices(f.quote,null).length,3);
});
test('recipients include sales owner, quotation user and all active admin roles, without customers or unrelated sales',()=>{
 const f=fixture();f.lead.email='customer@example.test';f.users.push({...f.users[0],role:'admin'});const emails=recipientUsers(f.quote,f.lead,openServices(f.quote,f.lead),f.users).map(user=>user.email).sort();assert.deepEqual(emails,['admin@example.test','sales@example.test','staff@example.test','super@example.test']);
});
test('first reminder waits seven days, repeats weekly only for remaining services, and stops after all close',async t=>{
 const f=fixture();const{sent}=setup(t,f);const start=+f.quote.managementApproval.actionAt;
 await service.runApprovedQuotationPoReminders({now:new Date(start+WEEK-1)});assert.equal(sent.length,0);
 close(f.lead.assignments[0]);await service.runApprovedQuotationPoReminders({now:new Date(start+WEEK)});assert.equal(sent.length,4);assert.ok(sent.every(mail=>!mail.html.includes('Service a')&&mail.html.includes('Service b')&&mail.html.includes('Service c')));
 await service.runApprovedQuotationPoReminders({now:new Date(start+WEEK+3600000)});assert.equal(sent.length,4,'restart/scans must not resend the same weekly reminders');
 close(f.lead.assignments[1]);await service.runApprovedQuotationPoReminders({now:new Date(start+2*WEEK)});assert.equal(sent.length,8);assert.ok(sent.slice(4).every(mail=>!mail.html.includes('Service b')&&mail.html.includes('Service c')));
 close(f.lead.assignments[2]);await service.runApprovedQuotationPoReminders({now:new Date(start+3*WEEK)});assert.equal(sent.length,8);
});
test('provider failures retry only the failed recipient and never resubmit successful weekly emails',async t=>{
 const f=fixture();let fail=true;const{sent}=setup(t,f,{failEmail:email=>fail&&email==='staff@example.test'});const now=new Date(+f.quote.managementApproval.actionAt+WEEK);let result=await service.runApprovedQuotationPoReminders({now});assert.equal(result.failures,1);assert.equal(sent.length,3);fail=false;
 result=await service.runApprovedQuotationPoReminders({now:new Date(+now+6*60000)});assert.equal(result.emails,1);assert.equal(sent.length,4);assert.equal(sent.filter(mail=>mail.email==='admin@example.test').length,1);
});
test('fresh closure is checked again after claims, so services closed before sending do not trigger emails',async t=>{
 const f=fixture();const{sent,ledger}=setup(t,f,{closeBeforeSend:true});await service.runApprovedQuotationPoReminders({now:new Date(+f.quote.managementApproval.actionAt+WEEK)});assert.equal(sent.length,0);assert.equal(ledger.size,0);
});
test('dry runs perform no delivery claims or email writes; revised/rejected quotations do not send',async t=>{
 const f=fixture();const{sent,ledger}=setup(t,f);const now=new Date(+f.quote.managementApproval.actionAt+WEEK);const result=await service.runApprovedQuotationPoReminders({now,dryRun:true});assert.equal(result.recipientEmails,4);assert.equal(sent.length,0);assert.equal(ledger.size,0);
 f.quote.status='rejected';await service.runApprovedQuotationPoReminders({now});assert.equal(sent.length,0);
});
test('email safely escapes company/service content and never includes completed services',()=>{
 const f=fixture();f.quote.companyName='<img src=x>';f.quote.items[1].servicesOffered='<script>bad</script>';close(f.lead.assignments[0]);const html=emailHtml(f.users[0],[{quote:f.quote,pending:openServices(f.quote,f.lead)}]);assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<script>'));assert.ok(!html.includes('Service a'));assert.ok(html.includes('Still Not Closed'));assert.match(html,/Regards,<br><strong>Krishna Yadav<\/strong><br>Anant Tattva CRM/);
});


test('multiple quotations are batched into one message per recipient and remain independently deduplicated',async t=>{
 const f=fixture();const{sent}=setup(t,f);const second={...f.quote,_id:'507f1f77bcf86cd799439015',quotationNumber:'AT/26-27/502'};
 t.mock.method(Quotation,'find',()=>query([f.quote,second]));t.mock.method(Quotation,'findById',id=>query(String(id)===quoteId?f.quote:second));
 await service.runApprovedQuotationPoReminders({now:new Date(+f.quote.managementApproval.actionAt+WEEK)});assert.equal(sent.length,4);assert.ok(sent.every(mail=>mail.html.includes('AT/26-27/501')&&mail.html.includes('AT/26-27/502')));
});
test('legacy service labels take precedence over stale positional indices when the lead services reorder',()=>{
 const quote={...fixture().quote,items:[{sourceServiceIndex:0,servicesOffered:'Renewal',piboCategory:'Importer',eprCategory:'Plastic'}]};
 const lead={serviceSelections:[{assignedServiceId:'registration',servicesOffered:'New Registration',subApplicantType:'Importer',eprCategory:'Plastic'},{assignedServiceId:'renewal',servicesOffered:'Renewal',subApplicantType:'Importer',eprCategory:'Plastic'}],assignments:[close({assignedServiceId:'registration'}),{assignedServiceId:'renewal'}]};
 assert.equal(openServices(quote,lead).length,1);
});

test('DigitalOcean scheduler starts once, checks after startup and then hourly without keeping shutdown open',t=>{
 const timers=[];let unref=0;t.mock.method(global,'setTimeout',(_callback,delay)=>{timers.push(['startup',delay]);return{unref(){unref++;}};});t.mock.method(global,'setInterval',(_callback,delay)=>{timers.push(['interval',delay]);return{unref(){unref++;}};});
 service.startApprovedQuotationPoReminderScheduler();service.startApprovedQuotationPoReminderScheduler();assert.deepEqual(timers,[['startup',60000],['interval',3600000]]);assert.equal(unref,2);
});
