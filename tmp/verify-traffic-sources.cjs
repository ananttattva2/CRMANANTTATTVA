require('./src/config/loadEnv')();
const mongoose=require('mongoose');mongoose.set('autoIndex',false);mongoose.set('autoCreate',false);
const {mongoConfig,safeMongoError}=require('./src/config/mongoConfig');
(async()=>{const c=mongoConfig();await mongoose.connect(c.uri,{dbName:c.dbName,authSource:c.authSource,autoIndex:false,autoCreate:false,serverSelectionTimeoutMS:10000});try{
 const User=require('./src/models/User'),Option=require('./src/models/LeadDropdownOption');const actor=await User.findOne({email:'it_admin@ananttattva.com'}).select('_id name role roles crmUserId').lean();
 const controller=require('./src/controllers/leadRevenueController');let data;await controller.pipeline({user:actor},{json:value=>{data=value}},e=>{throw e});
 const {trafficSourceSummary,trafficSourceKey}=await import(require('url').pathToFileURL(require('path').resolve('../frontend/src/utils/trafficSources.mjs')));
 const options=await Option.find({field:'communicationMode'}).select('name').lean();const summary=trafficSourceSummary(data.rows,options.map(o=>o.name));
 const {uniquePipelineRows}=await import(require('url').pathToFileURL(require('path').resolve('../frontend/src/utils/leadPipeline.mjs')));const unique=uniquePipelineRows(data.rows);
 console.log(JSON.stringify({check:'traffic-sources',uniqueLeads:unique.length,countTotal:summary.reduce((n,s)=>n+s.count,0),modes:summary.map(s=>({mode:s.label,count:s.count}))}));
 const populated=summary.find(s=>s.count>0&&s.label!=='Other / Not specified');const row=unique.find(r=>trafficSourceKey(r.communicationMode)===populated?.key);
 if(row){let detail;await controller.services({user:actor,params:{kind:row.kind,id:row.id}},{json:value=>{detail=value},status(){return this}},e=>{throw e});console.log(JSON.stringify({check:'source-client-details',ok:detail.ok,contactFieldsPresent:Boolean(detail.clientDetails&&'email' in detail.clientDetails&&'communicationMode' in detail.clientDetails),services:detail.services.length}));}
 }finally{await mongoose.disconnect()}})().catch(e=>{console.error(safeMongoError(e));process.exitCode=1});
