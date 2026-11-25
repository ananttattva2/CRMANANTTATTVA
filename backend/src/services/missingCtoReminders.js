const {createHash,randomUUID}=require('node:crypto');
const Client=require('../models/Client');
const User=require('../models/User');
const Delivery=require('../models/ConsentReminderDelivery');
const {sendMail}=require('../utils/mailer');
const {userHasAnyRole}=require('../utils/userRoles');
const {financeApprovedServices,servicesClientFilter}=require('./financeApprovedClients');
const {clientMasterSourceRecordFilter}=require('./clientMasterVisibility');
const {resolveClientMasterData,getSelectedLeadId,getAssignedServiceId}=require('./clientMasterResolver');
const {needsPieceWeight}=require('../../../shared/productQuantity.cjs');
const id=value=>String(value?._id||value||'').trim();
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const filled=value=>value!==null&&value!==undefined&&String(value).trim()!=='';
function missingCtoFields(data={}) {
  const plants=data.cte?.plantWiseDetails;
  if(!Array.isArray(plants)||!plants.length)return ['CTO/CCA plant details'];
  const missing=[];
  plants.forEach((plant,index)=>{
    const prefix=plant.plantName||`Plant ${index+1}`;
    for(const [key,label]of [['plantName','Plant name'],['ctoOrderNo','Order number'],['ctoIssueDate','Issue date'],['ctoValidDate','Valid until']])if(!filled(plant[key]))missing.push(`${prefix}: ${label}`);
    const document=plant.ctoDocument;
    if(!(typeof document==='string'?document.trim():document?.url||document?.secureUrl||document?.file?.url||document?.file?.secureUrl))missing.push(`${prefix}: CTO/CCA document`);
    const products=plant.ctoProductRows;
    if(!products?.length)missing.push(`${prefix}: Product quantity`);
    else products.forEach((row,productIndex)=>{for(const[key,label]of [['productName','Product name'],['quantity','Quantity'],['uom','UOM'],['period','Month/Year'],...(needsPieceWeight(row)?[['pieceWeight','Per piece weight'],['pieceWeightUom','PPW UOM']]:[])])if(!filled(row[key]))missing.push(`${prefix}, product ${productIndex+1}: ${label}`);});
  });
  return missing;
}
function buildMissingCtoRows(services,clients,users) {
  const findUser=(...values)=>values.filter(Boolean).map(value=>users.find(user=>[user._id,user.crmUserId,user.email,user.name].map(v=>id(v).toLowerCase()).includes(id(value).toLowerCase()))).find(Boolean);
  const rows=[];
  for(const item of services) {
    const {lead,assignment,service,serviceId}=item;
    if(!assignment.assignedTo&&!assignment.assignedToText&&!assignment.assignedToEmail)continue;
    const matches=clients.filter(client=>(getSelectedLeadId(client)===id(lead._id)||client.data?.importMeta?.leadNumber===lead.leadCode||client.data?.selectedLeadSnapshot?.leadCode===lead.leadCode)&&(getAssignedServiceId(client)===serviceId||(!getAssignedServiceId(client)&&lead.assignments?.length===1)));
    const client=matches.sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt))[0];
    const missing=missingCtoFields(client?resolveClientMasterData(client,serviceId):{});
    if(!missing.length)continue;
    const staff=findUser(assignment.assignedStaff,assignment.assignedStaffEmail,assignment.assignedStaffText,client?.createdBy);
    const manager=findUser(assignment.assignedTo,assignment.assignedToEmail,assignment.assignedToText,staff?.managerId);
    const sales=findUser(lead.generatedForUser,lead.generatedForEmail,lead.generatedForName)||findUser(lead.createdBy,lead.createdByEmail,lead.createdByName);
    const creator=findUser(client?.createdBy);
    rows.push({key:`${id(lead._id)}:${serviceId||item.index}`,client:client?.data?.basic?.clientLegalName||lead.company||lead.leadCode,leadCode:lead.leadCode,service:service.servicesOffered||service.applicableService||'-',year:service.firstAnnualReturnYearApplicable||service.financialYear||'-',staff:staff?.name||assignment.assignedStaffText||'Not assigned',manager:manager?.name||assignment.assignedToText||'Not recorded',sales:sales?.name||lead.generatedForName||lead.createdByName||'Not recorded',missing,recipientIds:[staff,manager,sales,creator].filter(Boolean).map(user=>id(user._id))});
  }
  return rows;
}
function digestEmail(rows) {
 const fields=['Client','Lead ID','Service','Financial year','Assigned user','Manager','Sales owner','Missing CTO/CCA details'];
 const values=row=>[row.client,row.leadCode,row.service,row.year,row.staff,row.manager,row.sales,row.missing.join('; ')];
 const html=`<p>Dear Team,</p><p>The following <strong>${rows.length} client service record(s)</strong> have a Finance-approved Purchase Order and an assigned manager, but their CTO/CCA details are still incomplete.</p><p>Please review the missing information below, coordinate with the responsible user and sales owner, and complete the CTO/CCA section in Client Master.</p><table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:12px"><thead><tr>${fields.map(v=>`<th>${escape(v)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${values(row).map(v=>`<td>${escape(v)}</td>`).join('')}</tr>`).join('')}</tbody></table><p>Each row identifies the client, assigned user, manager and sales owner. Completed records will be removed from the next daily report.</p><p>Regards,<br>CRM Compliance Team</p>`;
 const cell=value=>'"'+String(value??'').replace(/^[=+@-]/,"'$&").replace(/"/g,'""')+'"';
 const csv=[fields,...rows.map(values)].map(row=>row.map(cell).join(',')).join('\r\n');
 return {subject:`Action required: CTO/CCA details pending (${rows.length} client service records)`,html,csv};
}
let running=false,started=false;
async function runMissingCtoReminders(options={}) {
 if(running)return {skipped:'already_running'};running=true;
 try{
  const services=options.services||await financeApprovedServices();
  const clients=options.clients||await Client.find({$and:[clientMasterSourceRecordFilter(),servicesClientFilter(services)]}).select('selectedLead assignedServiceId data createdBy updatedAt').lean();
  const users=options.users||await User.find({isActive:{$ne:false}}).select('_id crmUserId name email role roles managerId').lean();
  const rows=buildMissingCtoRows(services,clients,users),buckets=new Map();
  for(const user of users){if(!user.email||user.isActive===false)continue;const mine=userHasAnyRole(user,['admin','superadmin'])?rows:rows.filter(row=>row.recipientIds.includes(id(user._id)));if(mine.length){const email=user.email.trim().toLowerCase();const existing=buckets.get(email)||[];buckets.set(email,[...new Map([...existing,...mine].map(row=>[row.key,row])).values()]);}}
  const result={pending:rows.length,recipients:buckets.size,sent:0,errors:0};
  if(options.dryRun)return {...result,rows};
  const now=options.now||new Date(),day=new Date(now.getTime()+330*60000).toISOString().slice(0,10),deliveries=options.deliveries||Delivery,send=options.send||sendMail;
  for(const[recipient,mine]of buckets){
   const key=createHash('sha256').update(`missing-cto|${day}|${recipient}`).digest('hex'),claim=randomUUID();
   await deliveries.updateOne({key},{$setOnInsert:{key,status:'pending',recipient,kind:'missing-cto',validUntil:day}},{upsert:true}).catch(e=>{if(e.code!==11000)throw e;});
   const record=await deliveries.findOneAndUpdate({key,status:{$ne:'sent'},$or:[{leaseUntil:{$exists:false}},{leaseUntil:{$lte:now}}]},{$set:{status:'sending',claim,leaseUntil:new Date(now.getTime()+15*60000)}},{new:true});
   if(!record)continue;
   try{const mail=digestEmail(mine);const delivered=await send(recipient,mail.subject,mail.html,{branded:false,attachments:[{filename:'pending-cto-details.csv',content:Buffer.from(mail.csv),contentType:'text/csv'}]});if(delivered?.summary?.rejected?.length&&!delivered.summary.accepted?.length)throw Error('Recipient rejected');await deliveries.updateOne({key,claim},{$set:{status:'sent',sentAt:now},$unset:{claim:1,leaseUntil:1}});result.sent++;}
   catch(error){result.errors++;await deliveries.updateOne({key,claim},{$set:{status:'pending'},$unset:{claim:1,leaseUntil:1}});console.error('Missing CTO digest delivery failed',{name:error.name});}
  }
  return result;
 }finally{running=false;}
}
function startMissingCtoReminderScheduler(){if(started)return;started=true;const run=()=>runMissingCtoReminders().catch(e=>console.error('Missing CTO scan failed',{name:e.name}));setTimeout(run,60000).unref();setInterval(run,60*60*1000).unref();}
module.exports={missingCtoFields,buildMissingCtoRows,digestEmail,runMissingCtoReminders,startMissingCtoReminderScheduler};
