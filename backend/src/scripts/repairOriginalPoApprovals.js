// Audit only by default. Run with --apply to recover missing original-PO reviews.
// Defaults to the reported lead; --all audits the same defect across every lead.
require('../config/loadEnv')();
const mongoose = require('mongoose');
const fs = require('node:fs/promises');
const path = require('node:path');
const { mongoConfig, safeMongoError } = require('../config/mongoConfig');
const Lead = require('../models/Lead');
const Approval = require('../models/PendingApproval');
const User = require('../models/User');
const { upsertPurchaseOrderApprovals } = require('../controllers/leadController')._test;
(async () => {
 try {
  const config = mongoConfig();
  await mongoose.connect(config.uri,{dbName:config.dbName,authSource:config.authSource,serverSelectionTimeoutMS:15000,autoIndex:false});
  const apply = process.argv.includes('--apply');
  const filter = { 'assignments.originalPoConfirmed':true, ...(process.argv.includes('--all') ? {} : {leadCode:'ATPL-LEAD-0077'}) };
  let missing=0, repaired=0;
  for await (const lead of Lead.find(filter).cursor()) {
   for (let index=0; index<lead.assignments.length; index++) {
    const row=lead.assignments[index];
    if (row.poStatus !== 'permanently_closed' || !row.originalPoConfirmed) continue;
    const sourceClientId=`${lead._id}:po:${row.assignedServiceId || index}`;
    // Include deleted rows in this check: never recreate a deliberately deleted approval.
    const existing=await Approval.collection.findOne({type:'purchase_order',source:'crm',sourceClientId});
    if (existing) continue;
    const po=row.originalPoDetails;
    if (!po?.poNumber || !(Number(po.poAmount)>0) || !po.poFileUrl) {console.info('Manual review required',lead.leadCode,index);continue;}
    missing++;
    console.info(apply?'Recovering':'Missing original PO approval',lead.leadCode,index+1,po.fy,po.poNumber);
    if (!apply) continue;
    const beforeLead=lead.toObject();
    const directory=path.resolve(__dirname,'../../../.original-po-approval-backups');
    await fs.mkdir(directory,{recursive:true});
    await fs.writeFile(path.join(directory,`${lead._id}-${index}-${Date.now()}.json`),JSON.stringify(beforeLead),{flag:'wx',mode:0o600});
    // Recover the original submission; do not use the old provisional approval screenshot.
    lead.assignments[index]={...row,poYearRows:[{...po,currency:po.currency || 'INR'}],poApprovalStatus:'PENDING'};
    const submitterId=row.permanentClosedBy;
    const submitter=mongoose.isValidObjectId(submitterId) ? await User.findById(submitterId).select('_id name email role roles').lean() : null;
    const actor=submitter || {_id:submitterId,name:row.permanentClosedByText || 'Original PO submitter'};
    await require('../services/poReviewFreeze').assertLeadPoEditable(lead._id,beforeLead,{assignments:lead.assignments});
    await upsertPurchaseOrderApprovals({beforeLead,lead,actor,submittedAssignments:lead.assignments,originalPoAssignmentIndexes:[index]});
    lead.markModified('assignments');
    await lead.save();
    repaired++;
   }
  }
  if (repaired) await require('../services/crmCache').invalidateCrmCache();
  console.info(JSON.stringify({apply,missing,repaired}));
 } catch(error) {console.error('Original PO recovery unavailable',safeMongoError(error));process.exitCode=1;}
 finally {await mongoose.disconnect();}
})();
