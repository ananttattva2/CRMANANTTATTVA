require('./src/config/loadEnv')();
const mongoose=require('mongoose');mongoose.set('autoIndex',false);mongoose.set('autoCreate',false);
const {mongoConfig,safeMongoError}=require('./src/config/mongoConfig');
(async()=>{const c=mongoConfig();await mongoose.connect(c.uri,{dbName:c.dbName,authSource:c.authSource,autoIndex:false,autoCreate:false,serverSelectionTimeoutMS:10000});try{
 const Revenue=require('./src/models/LeadRevenue');const User=require('./src/models/User');
 const entry=await Revenue.findById('6ae47787c332e12f1be5dad1').lean();
 const actor=await User.findOne({email:'it_support@ananttattva.com'}).select('_id name email role roles crmUserId').lean();
 if(!entry||!actor)throw new Error('Verification record missing');
 const controller=require('./src/controllers/leadRevenueController');let blockedWrites=0;
 Revenue.findOneAndUpdate=async()=>{blockedWrites++;return {_id:entry._id}};
 for(const [label,amount] of [['current-value',String(entry.amountPaise/100)],['positive-value','12500'],['zero','0'],['exponent','1e5'],['formatted','1,00,000']]){
  let status=200,body;
  await controller.correct({user:actor,params:{kind:'hot',id:'6a7426123e6eb1b90295ed74',entryId:String(entry._id)},body:{amount,reason:'Read-only validation; database mutation blocked',expectedPaise:entry.amountPaise,expectedRevision:(entry.corrections||[]).length,requestId:require('crypto').randomUUID()}},{status(code){status=code;return this},json(value){body=value}},e=>{throw e});
  console.log(JSON.stringify({case:label,status,error:body?.error}));
 }
 console.log(JSON.stringify({databaseWrites:0,blockedMutationCalls:blockedWrites}));
 }finally{await mongoose.disconnect()}})().catch(e=>{console.error(safeMongoError(e));process.exitCode=1});
