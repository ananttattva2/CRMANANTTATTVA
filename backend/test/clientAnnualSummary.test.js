const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
test('Annual Return completion merges records and closed PO years without double-counting',async()=>{
 const client={_id:'client',data:{annualReturn:{filings:{'2025-26':{status:'completed'},'2024-25':{status:'draft'}}}}};
 const sandbox={exports:{},require:name=>{
  if(name==='../models/Client')return{findOne:()=>({select:()=>({lean:async()=>client})})};
  if(name==='../models/AnnualReturn')return{find:()=>({select:()=>({lean:async()=>[{annualYear:'2025-26',status:'draft',filings:{}},{annualYear:'2024-25',status:'draft',filings:{}}]})})};
  if(name==='./clientController')return{clientAccessFilter:async()=>({createdBy:'worker'})};
  return{resolveServiceHistory:async()=>[{annual:true,annualYear:'2025-26'},{annual:true,annualYear:'2026-27'},{annual:false,annualYear:'2027-28'}]};
 }};vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../src/controllers/clientAnnualSummaryController.js'),'utf8'),sandbox);let data;
 await sandbox.exports.get({params:{id:'client'},user:{_id:'worker'}},{json:value=>{data=value;}},error=>{throw error;});
 assert.equal(data.total,3);assert.equal(data.completed,1);assert.equal(data.pending,2);assert.equal(data.rows.find(row=>row.annualYear==='2025-26').completed,true);
});
