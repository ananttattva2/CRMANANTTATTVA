require('./backend/node_modules/dotenv').config({path:'backend/.env',quiet:true});
const mongoose=require('./backend/node_modules/mongoose');mongoose.set('autoIndex',false);
const {buildMongoUri,mongoConfig}=require('./backend/src/config/mongoConfig');
(async()=>{const cfg=mongoConfig();await mongoose.connect(buildMongoUri(),{dbName:cfg.dbName,authSource:cfg.authSource,serverSelectionTimeoutMS:10000,autoIndex:false});
const user=await require('./backend/src/models/User').findOne({isActive:true,role:'admin'}).select('_id').lean();
const token=require('./backend/node_modules/jsonwebtoken').sign({sub:String(user._id)},process.env.JWT_SECRET||'secret',{expiresIn:60});
for(const endpoint of ['/leads/duplicate-approvals?listOnly=true&type=purchase_order','/leads/summary-dashboard','/leads?paginated=true&page=1&limit=25&search=soltex']){const at=Date.now();const response=await fetch('http://127.0.0.1:4000/api'+endpoint,{headers:{Authorization:'Bearer '+token,'Cache-Control':'no-cache'},signal:AbortSignal.timeout(20000)});const text=await response.text();let body;try{body=JSON.parse(text);}catch{}console.log(JSON.stringify({endpoint,status:response.status,ms:Date.now()-at,bytes:text.length,rows:body?.rows?.length||body?.approvals?.length||body?.leads?.length,timing:response.headers.get('server-timing'),error:body?.error}));}
await mongoose.disconnect();process.exit(0);})().catch(e=>{console.error('verification_failed',e.name,e.code);process.exit(1);});
