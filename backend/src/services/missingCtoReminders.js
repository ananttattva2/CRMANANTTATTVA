const {hydrateClientData}=require('./clientMasterHydration');
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
    const target=client||{selectedLead:lead._id,assignedServiceId:serviceId,data:{basic:{piboCategory:service.subApplicantType||service.piboCategory,eprCategory:service.eprCategory}}};
    const missing=missingCtoFields(hydrateClientData(target,clients,serviceId));
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
module.exports={missingCtoFields,buildMissingCtoRows,digestEmail};
