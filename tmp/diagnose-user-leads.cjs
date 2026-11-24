const path=require('path');require('../backend/node_modules/dotenv').config({path:path.resolve('backend/.env'),quiet:true});
const mongoose=require('../backend/node_modules/mongoose');mongoose.set('autoIndex',false);
const {buildMongoUri,mongoConfig}=require('../backend/src/config/mongoConfig');
(async()=>{const c=mongoConfig();await mongoose.connect(buildMongoUri(),{dbName:c.dbName,authSource:c.authSource,serverSelectionTimeoutMS:10000,autoIndex:false});
const User=require('../backend/src/models/User');const user=await User.findOne({isActive:true,role:{$nin:['admin','superadmin']}}).select('_id crmUserId name email role roles teamId managerId operationHeadId').lean();
const {leadAccessFilter}=require('../backend/src/controllers/leadController');let at=Date.now();const filter=await leadAccessFilter(user,{includeShared:true});console.log('scope_ms',Date.now()-at,'filter_bytes',JSON.stringify(filter).length);
const Lead=require('../backend/src/models/Lead');
for(const [name,run] of Object.entries({count:()=>Lead.countDocuments({$and:[filter,{'noOwner.active':{$ne:true}}]}).maxTimeMS(10000),page:()=>Lead.aggregate([{$match:{$and:[filter,{'noOwner.active':{$ne:true}}]}},{$sort:{leadCode:1,createdAt:1}},{$limit:10},{$project:{leadCode:1}}]).option({maxTimeMS:10000}),summary:()=>Lead.aggregate([{$match:filter},{$count:'total'}]).option({maxTimeMS:10000})})){at=Date.now();try{const result=await run();console.log(name,'ms',Date.now()-at,'count',Array.isArray(result)?result.length:result);}catch(e){console.log(name,'ms',Date.now()-at,'error',e.name,e.code,e.codeName,String(e.message).slice(0,300));}}
await mongoose.disconnect();})().catch(e=>{console.log('diagnostic_failed',e.name,e.code,String(e.message).replace(/mongodb[^ ]*/g,'[database]').slice(0,250));process.exitCode=1});
