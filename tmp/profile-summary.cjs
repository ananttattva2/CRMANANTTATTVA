require('./backend/node_modules/dotenv').config({path:'backend/.env',quiet:true});
const mongoose=require('./backend/node_modules/mongoose');mongoose.set('autoIndex',false);
const {buildMongoUri,mongoConfig}=require('./backend/src/config/mongoConfig');
(async()=>{const cfg=mongoConfig();await mongoose.connect(buildMongoUri(),{dbName:cfg.dbName,authSource:cfg.authSource,serverSelectionTimeoutMS:10000,autoIndex:false});
const user=await require('./backend/src/models/User').findOne({isActive:true,role:{$nin:['admin','superadmin']}}).select('_id').lean();
const token=require('./backend/node_modules/jsonwebtoken').sign({sub:String(user._id)},process.env.JWT_SECRET||'secret',{expiresIn:60});
const original=mongoose.Query.prototype.exec;mongoose.Query.prototype.exec=async function(...args){const at=Date.now();try{const result=await original.apply(this,args);console.log('query',this.model.modelName,this.op,Date.now()-at,'ms',Array.isArray(result)?result.length:1);return result;}catch(e){console.log('query_error',this.model.modelName,this.op,e.name,e.code);throw e;}};
const admin=await require('./backend/src/models/User').findOne({isActive:true,role:'admin'}).lean();const ctrl=require('./backend/src/controllers/leadRevenueController');let at=Date.now();await ctrl.pipeline({user:admin,query:{}},{set(){},json(body){console.log('pipeline',Date.now()-at,'ms',body.rows.length);}},e=>console.log('pipeline_error',e.name,e.message));
await mongoose.disconnect();process.exit(0);})().catch(e=>{console.error('verification_failed',e.name,e.code);process.exit(1);});
