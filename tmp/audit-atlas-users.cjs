const { MongoClient } = require('mongodb');
require('./src/config/loadEnv')();
const { mongoConfig, safeMongoError } = require('./src/config/mongoConfig');
(async () => {
 const config = mongoConfig();
 const host = config.uri.replace(/^mongodb(?:\+srv)?:\/\/(?:[^/]*@)?/, '').split(/[/?]/)[0];
 console.log(JSON.stringify({check:'target',host,database:config.dbName,authSource:config.authSource}));
 const client = new MongoClient(config.uri,{authSource:config.authSource,serverSelectionTimeoutMS:10000});
 try {
  await client.connect();
  const db=client.db(config.dbName), users=db.collection('users');
  console.log(JSON.stringify({check:'users',total:await users.countDocuments({}),active:await users.countDocuments({isActive:true}),inactive:await users.countDocuments({isActive:false})}));
  const projection={_id:1,name:1,email:1,role:1,isActive:1,createdAt:1,updatedAt:1};
  console.log(JSON.stringify({check:'test-users',users:await users.find({$or:[{name:/test/i},{email:/test/i}]},{projection}).toArray()}));
  console.log(JSON.stringify({check:'latest-users',users:await users.find({},{projection}).sort({createdAt:-1}).limit(5).toArray()}));
  console.log(JSON.stringify({check:'provided-users',users:await users.find({email:{$in:['it_admin@ananttattva.com','it_support@ananttattva.com']}},{projection}).toArray()}));
 } finally { await client.close(); }
})().catch(e=>{console.error(safeMongoError(e));process.exitCode=1});
