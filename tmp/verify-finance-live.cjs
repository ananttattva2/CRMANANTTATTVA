require('./backend/node_modules/dotenv').config({path:'backend/.env',quiet:true});
const mongoose=require('./backend/node_modules/mongoose');mongoose.set('autoIndex',false);mongoose.set('autoCreate',false);
const {buildMongoUri,mongoConfig}=require('./backend/src/config/mongoConfig');
(async()=>{const cfg=mongoConfig();await mongoose.connect(buildMongoUri(),{dbName:cfg.dbName,authSource:cfg.authSource,autoIndex:false,autoCreate:false,serverSelectionTimeoutMS:10000});
if(!process.env.JWT_SECRET)throw Error('Missing signing config');
for(const role of ['accounts','admin','superadmin','manager']){const user=await require('./backend/src/models/User').findOne({isActive:true,role}).select('_id').lean();if(!user){console.log(JSON.stringify({role,skipped:'No active account'}));continue;}const token=require('./backend/node_modules/jsonwebtoken').sign({sub:String(user._id)},process.env.JWT_SECRET,{expiresIn:60});const start=Date.now();const res=await fetch('https://crmananttattva.com/api/leads/finance-approvals',{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)});const body=await res.json();console.log(JSON.stringify({role,status:res.status,rows:body.approvals?.length,ms:Date.now()-start}));if(res.status!==(role==='manager'?403:200))throw Error('Unexpected access');}
await mongoose.disconnect();})().catch(e=>{console.error(e.name,e.message);process.exit(1)});
