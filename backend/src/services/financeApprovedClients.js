const Approval = require('../models/PendingApproval');
const Lead = require('../models/Lead');
const id = value => String(value?._id || value || '').trim();
function finalFinanceApproval(row = {}) {
  return row.approvalStatus === 'APPROVED' && row.poReview?.stage === 'FINALIZED' && row.poReview?.finalStatus === 'APPROVED';
}
async function financeApprovedServices({ ApprovalModel = Approval, LeadModel = Lead } = {}) {
  const approvals = await ApprovalModel.find({type:'purchase_order',approvalStatus:'APPROVED','poReview.stage':'FINALIZED','poReview.finalStatus':'APPROVED'}).select('payload.leadId payload.assignmentIndex payload.assignedServiceId approvalStatus poReview.stage poReview.finalStatus').lean();
  const leadIds = [...new Set(approvals.map(a=>id(a.payload?.leadId)).filter(Boolean))];
  if (!leadIds.length) return [];
  const leads = await LeadModel.find({_id:{$in:leadIds}}).lean();
  const result=[], seen=new Set();
  for(const approval of approvals) {
    if(!finalFinanceApproval(approval)) continue;
    const lead=leads.find(l=>id(l._id)===id(approval.payload?.leadId));
    if(!lead) continue;
    const serviceId=id(approval.payload?.assignedServiceId);
    const matches=(lead.assignments||[]).map((row,index)=>({row,index})).filter(({row,index})=>serviceId ? id(row.assignedServiceId||row.serviceAssignmentId)===serviceId : index===Number(approval.payload?.assignmentIndex));
    if(matches.length!==1) continue;
    const {row:assignment,index}=matches[0];
    if(String(assignment.poApprovalStatus||'').toUpperCase()!=='APPROVED') continue;
    if(!(assignment.closedBy||assignment.closedAt||assignment.permanentClosedAt||assignment.closureRequestedBy||['received','permanently_closed'].includes(assignment.poStatus)||lead.closedBy||lead.closedAt)) continue;
    const key=id(lead._id)+':'+(serviceId||index);
    if(seen.has(key)) continue;seen.add(key);
    const service=(lead.serviceSelections||[]).find(s=>serviceId&&id(s.assignedServiceId||s.serviceAssignmentId)===serviceId)||lead.serviceSelections?.[index]||{};
    result.push({lead,assignment,index,service,serviceId:serviceId||id(assignment.assignedServiceId)});
  }
  return result;
}
function leadReferences(lead) {
  const values=[lead._id,id(lead._id)];
  return {$or:[{selectedLead:lead._id},{'data.selectedLead':{$in:values}},{'data.selectedLeadSnapshot.id':{$in:values}},{'data.sourceLeadId':{$in:values}},...(lead.leadCode?[{'data.importMeta.leadNumber':lead.leadCode},{'data.selectedLeadSnapshot.leadCode':lead.leadCode}]:[])]};
}
function servicesClientFilter(services) {
  const branches=services.map(({lead,serviceId})=>({$and:[leadReferences(lead),{$or:[
    ...(serviceId?[{assignedServiceId:serviceId},{$and:[{assignedServiceId:{$in:['',null]}},{'data.assignedServiceId':serviceId}]},{$and:[{assignedServiceId:{$in:['',null]}},{'data.assignedServiceId':{$in:['',null]}},{'data.selectedLeadSnapshot.assignedServiceId':serviceId}]}]:[]),
    ...((lead.assignments||[]).length===1?[{assignedServiceId:{$in:['',null]},'data.assignedServiceId':{$in:['',null]},'data.selectedLeadSnapshot.assignedServiceId':{$in:['',null]}}]:[])
  ]}]}));
  return branches.length?{$or:branches}:{_id:{$in:[]}};
}
async function financeApprovedClientFilter(options) {return servicesClientFilter(await financeApprovedServices(options));}
function managerAssignmentError(before={},next={},approved=[]) {
  const changes=(next.assignments||[]).map((row,index)=>({row,index,previous:(before.assignments||[]).find(old=>row.assignedServiceId&&id(old.assignedServiceId)===id(row.assignedServiceId))||before.assignments?.[index]||{}})).filter(({row,previous})=>row.assignedTo&&id(row.assignedTo)!==id(previous.assignedTo));
  if(next.assignedTo&&id(next.assignedTo)!==id(before.assignedTo)) changes.push({row:next.assignments?.[0]||before.assignments?.[0]||{},index:0});
  return changes.some(({ row, index }) => {
    const serviceId = id(row.assignedServiceId || row.serviceAssignmentId);
    const original = serviceId
      ? before.assignments?.find(item => id(item.assignedServiceId || item.serviceAssignmentId) === serviceId)
      : before.assignments?.[index];
    const status = String(original?.poApprovalStatus || '').toUpperCase();
    if (['FINANCE_PENDING', 'PARTIALLY_APPROVED'].includes(status)) return false;
    return !approved.some(item => id(item.lead._id) === id(before._id) &&
      (serviceId ? item.serviceId === serviceId : item.index === index));
  }) ? 'Admin must approve this service Purchase Order before assigning a manager.' : '';
}
module.exports={managerAssignmentError,finalFinanceApproval,financeApprovedServices,servicesClientFilter,financeApprovedClientFilter};
