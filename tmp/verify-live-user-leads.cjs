require('./backend/node_modules/dotenv').config({path:'backend/.env',quiet:true});
const mongoose=require('./backend/node_modules/mongoose');mongoose.set('autoIndex',false);
const {buildMongoUri,mongoConfig}=require('./backend/src/config/mongoConfig');
(async()=>{const cfg=mongoConfig();await mongoose.connect(buildMongoUri(),{dbName:cfg.dbName,authSource:cfg.authSource,serverSelectionTimeoutMS:10000,autoIndex:false});
const user=await require('./backend/src/models/User').findOne({isActive:true,role:{$nin:['admin','superadmin']}}).select('_id').lean();
const token=require('./backend/node_modules/jsonwebtoken').sign({sub:String(user._id)},process.env.JWT_SECRET||'secret',{expiresIn:60});
for(const search of ['', 'el', 'elkay']){const params=new URLSearchParams({paginated:'true',directory:'true',page:'1',limit:'10',workspace:'leads',search});const at=Date.now();const response=await fetch('http://127.0.0.1:4000/api/leads?'+params,{headers:{Authorization:'Bearer '+token,'Cache-Control':'no-cache'},signal:AbortSignal.timeout(15000)});const body=await response.json();console.log(JSON.stringify({search,status:response.status,ms:Date.now()-at,rows:body.leads?.length,total:body.pagination?.total,timing:response.headers.get('server-timing'),error:body.error}));}
await mongoose.disconnect();process.exit(0);})().catch(e=>{console.error('verification_failed',e.name,e.code);process.exit(1);});
