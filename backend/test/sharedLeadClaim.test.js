const test=require('node:test'),assert=require('node:assert/strict');
const Lead=require('../src/models/Lead');
const {isSharedLead,prepareSharedLeadClaim}=require('../src/services/sharedLeadClaim');
const actor={_id:'507f1f77bcf86cd799439011',name:'KRISHNA Yadav',email:'krishna@example.test',crmUserId:'AT-U-11'};
const other={_id:'507f1f77bcf86cd799439012',name:'Other User',email:'other@example.test'};
const now=new Date('2026-11-23T10:00:00Z'),old=new Date('2026-10-01T10:00:00Z');
function sample(active=true){return{_id:'507f1f77bcf86cd799439099',__v:0,company:'Shared Company',status:'Open',createdAt:old,updatedAt:old,createdBy:'507f1f77bcf86cd799439013',createdByName:'Previous Owner',generatedForUser:'507f1f77bcf86cd799439013',noOwner:{active,previousOwner:active?{name:'Previous Owner'}:undefined},serviceSelections:[{assignedServiceId:'s1',createdByName:'Previous Owner'}],assignments:[]};}
test('status or follow-up edit assigns all ownership identities to the acting user and preserves previous owner',()=>{
 for(const data of [{status:'Interested'},{serviceSelections:[{assignedServiceId:'s1',nextFollowUpDate:'2026-11-25',followUpRemarks:'Call client'}]}]){
  const before=sample(),lead=Lead.hydrate(before),patch=prepareSharedLeadClaim(lead,before,data,actor,now);
  assert.equal(String(patch.generatedForUser),actor._id);assert.equal(String(patch.createdBy),actor._id);assert.equal(patch.generatedForName,'KRISHNA Yadav');assert.equal(patch.noOwner.active,false);assert.equal(patch.noOwner.previousOwner.name,'Previous Owner');assert.equal(patch.noOwner.reassignedAt,now);assert.equal(patch.serviceSelections[0].createdByName,'KRISHNA Yadav');assert.equal(lead.$where.updatedAt,old);assert.deepEqual(lead.$where.$or[0],{'noOwner.active':true});
 }
 assert.equal(isSharedLead(sample(false),now.getTime()),true,'inactivity-based rows can be claimed before the scheduler runs');
 assert.equal(isSharedLead({...sample(false),updatedAt:now},now.getTime()),false);
});
test('two simultaneous shared-lead edits atomically persist only the first claimant',async t=>{
 const snapshot=sample();let active=true,owner='',writes=0;
 t.mock.method(Lead.collection,'updateOne',async(filter,update)=>{
  assert.deepEqual(filter.$or[0],{'noOwner.active':true});assert.equal(new Date(filter.updatedAt).getTime(),old.getTime());
  if(!active)return{matchedCount:0,modifiedCount:0};active=false;owner=String(update.$set.generatedForUser);writes++;return{matchedCount:1,modifiedCount:1};
 });
 const first=Lead.hydrate(snapshot),second=Lead.hydrate(snapshot);
 first.set(prepareSharedLeadClaim(first,snapshot,{status:'Interested'},actor,now));second.set(prepareSharedLeadClaim(second,snapshot,{status:'Call Back'},other,now));
 await first.save();await assert.rejects(second.save(),error=>['DocumentNotFoundError','VersionError'].includes(error.name));assert.equal(writes,1);assert.equal(owner,actor._id);
});
test('failed validation never claims the lead',async t=>{
 let writes=0;t.mock.method(Lead.collection,'updateOne',async()=>{writes++;return{matchedCount:1};});
 const before=sample(),lead=Lead.hydrate(before);lead.set(prepareSharedLeadClaim(lead,before,{piboParent:'INVALID'},actor,now));await assert.rejects(lead.save(),error=>error.name==='ValidationError');assert.equal(writes,0);
});

test('lead update API lets a normal user claim a shared lead, audits the change and rejects stale pool updates',async t=>{
 const controller=require('../src/controllers/leadController'),Activity=require('../src/models/LeadActivity');
 t.mock.method(Lead.collection,'updateOne',async()=>({matchedCount:1,modifiedCount:1}));
 const lead=Lead.hydrate(sample());let saves=0;const events=[];
 t.mock.method(Lead,'findOne',async filter=>{assert.ok(filter.$and?.some(part=>part.$or?.some(branch=>branch.$or?.some(value=>value['noOwner.active']===true))) || filter._id);return lead;});
 t.mock.method(lead,'save',async()=>{saves++;lead.updatedAt=new Date();return lead;});
 t.mock.method(Activity,'create',async event=>{events.push(event);return event;});
 const res={code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
 await controller.updateLead({params:{id:String(lead._id)},body:{status:'Interested'},get:()=>'',user:{...actor,role:'sales'}},res);
 assert.equal(res.code,200,res.body?.error);assert.equal(saves,1);assert.equal(String(res.body.lead.generatedForUser),actor._id);assert.equal(res.body.lead.noOwner.active,false);assert.ok(events.some(event=>event.title==='Shared lead claimed'));
 const stale={...res,code:200,body:null};await controller.updateLead({params:{id:String(lead._id)},body:{status:'Call Back',noOwner:{active:true}},get:()=>'',user:{...other,role:'sales'}},stale);
 assert.equal(stale.code,409);assert.equal(saves,1);assert.equal(String(lead.generatedForUser),actor._id);
});
