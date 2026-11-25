const Client=require('../models/Client');
const {clientMasterSourceRecordFilter}=require('./clientMasterVisibility');
const {getAssignedServiceId,getSelectedLeadId,resolveClientMasterData,mergePopulated}=require('./clientMasterResolver');
const id=value=>String(value?._id||value||'');
const token=value=>String(value||'').toLowerCase().replace(/[^a-z0-9]/g,'');
const SHARED_SECTIONS=['companyOverview','basic','registeredAddress','communicationAddress','compliance','msmeRows','cte','cpcb','cpcbScreenshots','processDiagrams','otp','otpContacts','authorised','authorisedPersons','coordinating','coordinatingPersons'];
function applicant(data){return token(data.basic?.piboCategory||data.selectedLeadSnapshot?.subApplicantType||data.selectedLeadSnapshot?.piboCategory);}
function compatibleSource(target,source,serviceId){
 if(id(target._id)===id(source._id)||!getSelectedLeadId(target)||getSelectedLeadId(target)!==getSelectedLeadId(source))return false;
 const otherService=getAssignedServiceId(source);
 if(otherService&&otherService!==serviceId)return false;
 const a=resolveClientMasterData(target,serviceId),b=resolveClientMasterData(source,serviceId);
 if(!applicant(a)||applicant(a)!==applicant(b))return false;
 const category=data=>token(data.basic?.eprCategory||data.selectedLeadSnapshot?.eprCategory);
 if(category(a)&&category(b)&&category(a)!==category(b))return false;
 return true;
}
function hydrateClientData(record,sources=[],serviceId=getAssignedServiceId(record)){
 let result=resolveClientMasterData(record,serviceId);
 const candidates=sources.filter(source=>compatibleSource(record,source,serviceId)).sort((a,b)=>Number(b.workflowStatus==='submitted')-Number(a.workflowStatus==='submitted')||new Date(b.updatedAt||0)-new Date(a.updatedAt||0)||id(b._id).localeCompare(id(a._id)));
 for(const source of candidates){
  const saved=resolveClientMasterData(source,serviceId);
  const fallback=Object.fromEntries(SHARED_SECTIONS.filter(key=>saved[key]!==undefined).map(key=>[key,saved[key]]));
  // Pending CPCB onboarding intentionally locks these sections; do not restore
  // credentials or restricted fields through an older source in that state.
  if(result.cpcbOnboarding?.cpcbPortalRegistered===false)for(const key of ['compliance','msmeRows','cte','cpcb','cpcbScreenshots','processDiagrams'])delete fallback[key];
  result=mergePopulated(result,fallback);
 }
 return result;
}
async function resolveHydratedClientData(record,serviceId=getAssignedServiceId(record),options={}){
 const leadId=getSelectedLeadId(record);
 if(!leadId)return resolveClientMasterData(record,serviceId);
 const Model=options.ClientModel||Client;
 const sources=await Model.find({$and:[{_id:{$ne:record._id}},{$or:[{selectedLead:leadId},{'data.selectedLead':leadId},{'data.selectedLeadSnapshot.id':leadId},{'data.sourceLeadId':leadId}]},clientMasterSourceRecordFilter(),options.accessFilter||{}]}).select('_id selectedLead assignedServiceId workflowStatus updatedAt data').lean();
 return hydrateClientData(record,sources,serviceId);
}
module.exports={compatibleSource,hydrateClientData,resolveHydratedClientData};
