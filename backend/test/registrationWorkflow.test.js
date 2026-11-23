const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
test('registration proof submission, manager then compliance approval, completion and notifications',async()=>{
 let row=null, emails=0;
 const clone=value=>value == null?value:JSON.parse(JSON.stringify(value));
 const matches=filter=>row && Object.entries(filter).every(([key,value])=>key==='_id'?row._id===value:typeof value==='object' && value?.$ne?row[key]!==value.$ne:row[key]===value);
 const model={findOne:()=>({lean:async()=>clone(row)}),findById:()=>({lean:async()=>clone(row)}),updateOne:async(filter,update)=>{for(const [key,value]of Object.entries(update.$set||{})){if(key.startsWith('notifications.')){row.notifications ||= {};row.notifications[key.split('.')[1]]=value;}}},findOneAndUpdate:async(filter,update,options)=>{if(!options.upsert&&!matches(filter))return null;row={...(row||{_id:'tracker',history:[],notifications:{},managerStatus:'PENDING',complianceStatus:'NOT_READY'}),...filter,...update.$set};delete row.registrationCompleted?.$ne;if(update.$push?.history)row.history.push(update.$push.history);return clone(row);}};
 const client={_id:'client',data:{basic:{clientLegalName:'Test Registration Client'}}};
 const users={worker:{_id:'worker',managerId:'manager'},manager:{_id:'manager',name:'Manager',email:'manager@example.test',isActive:true},compliance:{_id:'compliance',email:'compliance@example.test'}};
 const dependencies={
 '../models/Client':{findOne:()=>({lean:async()=>client}),findById:()=>({select:()=>({lean:async()=>client})})},
 '../models/RegistrationTracker':model,
 '../models/User':{findById:id=>({select:()=>({lean:async()=>users[id]})}),find:()=>({select:()=>({lean:async()=>[users.compliance]})})},
 '../models/Team':{}, '../utils/mailer':{sendMail:async()=>{emails++;return{};}},
 '../services/annualReturnPoResolver':{resolveServiceHistory:async()=>[{assignedServiceId:'reg',number:'PO1',registrationYear:'2026-27',service:'New Registration'}]},
 './clientController':{clientAccessFilter:async()=>({})}
 };
 const sandbox={exports:{},console,process,require:name=>dependencies[name]||require(path.resolve(__dirname,'../src/controllers',name))};vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../src/controllers/registrationTrackerController.js'),'utf8'),sandbox);
 const api=sandbox.exports;let result,failure;
 async function call(method,user,body){result=null;failure=null;await api[method]({method:'PUT',params:{id:'client',trackerId:'tracker'},user,body},{json:data=>{result=data;}},error=>{failure=error;});return result;}
 const worker={_id:'worker',name:'Worker',role:'operation'},manager={_id:'manager',name:'Manager',role:'manager'},compliance={_id:'compliance',role:'compliance'};
 const proof={name:'data.pdf',secureUrl:'https://example.test/data.pdf',url:'https://example.test/data.pdf'};
 const body={assignedServiceId:'reg',poNumber:'PO1',registrationYear:'2026-27',dataExplained:'yes',dataReceived:'yes',registrationCompleted:'no',explainedProof:proof,receivedProof:proof};
 await call('save',worker,{...body,explainedProof:null});assert.match(failure.message,/proof/);assert.equal(row,null);
 await call('save',worker,body);assert.equal(result.ok,true);assert.equal(emails,1);assert.equal(row.managerStatus,'PENDING');
 await call('save',worker,body);assert.equal(emails,1,'unchanged save must not duplicate email');
 await call('save',worker,{...body,registrationCompleted:'yes',proof});assert.match(failure.message,/Manager and Compliance/);
 await call('decide',compliance,{stage:'compliance',decision:'APPROVED',remarks:'checked'});assert.equal(failure.status,409);
 await call('decide',worker,{stage:'manager',decision:'APPROVED',remarks:'own'});assert.equal(failure.status,403);
 await call('decide',manager,{stage:'manager',decision:'APPROVED',remarks:'Data proofs verified'});assert.equal(row.managerStatus,'APPROVED');assert.equal(row.complianceStatus,'PENDING');assert.equal(emails,2);
 await call('decide',manager,{stage:'compliance',decision:'APPROVED',remarks:'not allowed'});assert.equal(failure.status,403);
 await call('decide',compliance,{stage:'compliance',decision:'APPROVED',remarks:'Compliant'});assert.equal(row.complianceStatus,'APPROVED');
 await call('save',worker,{...body,registrationCompleted:'yes',proof});assert.equal(result.ok,true);assert.equal(row.registrationCompleted,'yes');assert.equal(emails,3);
 await call('save',worker,{...body,registrationCompleted:'yes',proof});assert.equal(emails,3);
});
