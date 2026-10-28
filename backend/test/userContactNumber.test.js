const test = require('node:test');
const assert = require('node:assert/strict');
const User = require('../src/models/User');
const ctrl = require('../src/controllers/authController');
const { buildPortalData } = require('../src/services/clientPortal');
const res = () => ({ code:200, status(code){this.code=code;return this},json(body){this.body=body;return this} });
test('admin edit persists contact number, returns it, preserves omitted numbers and permits clearing',async()=>{
 const saved={find:User.findById,one:User.findOne};
 const user={_id:'u1',crmUserId:'AT1',name:'Manager',email:'manager@example.com',role:'operation',roles:['operation'],contactNumber:'9000000000',save:async()=>{}};
 try{
 User.findById=async()=>user;User.findOne=async()=>null;
 const body={name:'Manager',email:'manager@example.com',role:'operation',contactNumber:'+91 98765 43210'};
 const updated=res();await ctrl.updateUserByAdmin({params:{id:'u1'},body},updated);
 assert.equal(user.contactNumber,body.contactNumber);assert.equal(updated.body.user.contactNumber,body.contactNumber);
 const omitted=res();const {contactNumber,...without}=body;await ctrl.updateUserByAdmin({params:{id:'u1'},body:without},omitted);assert.equal(user.contactNumber,contactNumber);
 const bad=res();await ctrl.updateUserByAdmin({params:{id:'u1'},body:{...body,contactNumber:'invalid'}},bad);assert.equal(bad.code,400);
 const cleared=res();await ctrl.updateUserByAdmin({params:{id:'u1'},body:{...body,contactNumber:''}},cleared);assert.equal(user.contactNumber,'');
 }finally{User.findById=saved.find;User.findOne=saved.one}
});
test('SPOC phone comes from the assigned user record and is exposed to its client',()=>{
 const result=buildPortalData('client@example.com',[{_id:'l1',company:'Example',assignedStaff:'u1',assignments:[{assignedStaff:'u1'}]}],[],[],[],[{_id:'u1',name:'Account Manager',email:'manager@example.com',contactNumber:'+91 98765 43210'}]);
 assert.equal(result.clients[0].spoc.contactNumber,'+91 98765 43210');
 assert.equal(result.clients[0].assignments[0].spoc.contactNumber,'+91 98765 43210');
 const user=new User({name:'Manager',email:'manager@example.com',contactNumber:'+91 98765 43210'});
 assert.equal(user.toObject().contactNumber,'+91 98765 43210');
});


test('admin create user saves contact number and returns it in the directory response',async()=>{
 const saved={one:User.findOne,save:User.prototype.save};let persisted;
 try{User.findOne=async()=>null;User.prototype.save=async function(){persisted=this;return this;};
 const result=res();await ctrl.createUserByAdmin({body:{name:'New Handler',email:'new@example.com',password:'test-password-only',role:'operation',contactNumber:'+91 90000 00000'}},result);
 assert.equal(result.code,201);assert.equal(persisted.contactNumber,'+91 90000 00000');assert.equal(result.body.user.contactNumber,'+91 90000 00000');
 }finally{User.findOne=saved.one;User.prototype.save=saved.save;}
});
