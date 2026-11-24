require('./backend/node_modules/dotenv').config({path:'backend/.env',quiet:true});
const mongoose=require('./backend/node_modules/mongoose');mongoose.set('autoIndex',false);
const {buildMongoUri,mongoConfig}=require('./backend/src/config/mongoConfig');
(async()=>{const cfg=mongoConfig();await mongoose.connect(buildMongoUri(),{dbName:cfg.dbName,authSource:cfg.authSource,serverSelectionTimeoutMS:10000,autoIndex:false});
const user=await require('./backend/src/models/User').findOne({isActive:true,role:{$nin:['admin','superadmin']}}).select('_id').lean();
const token=require('./backend/node_modules/jsonwebtoken').sign({sub:String(user._id)},process.env.JWT_SECRET||'secret',{expiresIn:60});
const c=mongoose.connection.collection('crm_compact_read_snapshots');let at=Date.now();const stats=await c.aggregate([{$group:{_id:null,n:{$sum:1},bytes:{$sum:{$bsonSize:'$$ROOT'}},max:{$max:{$bsonSize:'$$ROOT'}}}}]).toArray();console.log('snapshot_size',JSON.stringify(stats),'ms',Date.now()-at);console.log('indexes',(await c.indexes()).map(i=>i.name));at=Date.now();const rows=await c.find({}, {projection:{_id:1,sourceId:1,version:1,schema:1}}).toArray();console.log('metadata_only',rows.length,'ms',Date.now()-at);
await mongoose.disconnect();process.exit(0);})().catch(e=>{console.error('verification_failed',e.name,e.code);process.exit(1);});
