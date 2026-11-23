const AnnualReturn = require('../models/AnnualReturn');
const Client = require('../models/Client');
exports.get = async (req,res,next) => {
  try {
    const access=await require('./clientController').clientAccessFilter(req.user);
    const client=await Client.findOne({$and:[{_id:req.params.id},access]}).select('data.basic data.annualReturn selectedLead assignedServiceId data.importMeta').lean();
    if(!client)return res.status(404).json({error:'Client not found or not accessible.'});
    const documents=await AnnualReturn.find({client:client._id}).select('annualYear status filings updatedAt approvalWorkflow').lean();
    const serviceRows=await require('../services/annualReturnPoResolver').resolveServiceHistory({clientMaster:client});
    const byYear=new Map(serviceRows.filter(row=>row.annual && row.annualYear).map(row=>[row.annualYear,{annualYear:row.annualYear,status:'pending'}]));
    const put=(year,filing)=>{if(!year)return;const previous=byYear.get(year);const completed=value=>['completed','complete','filed','approved','compliance_approved'].includes(String(value || '').toLowerCase());const status=filing.approvalWorkflow?.status || filing.status || 'draft';const done=completed(status);if(previous?.completed && !done)return;byYear.set(year,{annualYear:year,status,completed:done,updatedAt:filing.updatedAt || filing.savedAt || null});};
    Object.entries(client.data?.annualReturn?.filings || {}).forEach(([year,filing])=>put(year,filing));
    for(const doc of documents){put(doc.annualYear,doc);Object.entries(doc.filings || {}).forEach(([year,filing])=>put(year,filing));}
    const rows=[...byYear.values()].sort((a,b)=>b.annualYear.localeCompare(a.annualYear));
    const completed=rows.filter(row=>row.completed).length;
    return res.json({ok:true,rows,total:rows.length,completed,pending:rows.length-completed});
  }catch(error){next(error);}
};
