require('../backend/src/config/loadEnv')();
const mongoose = require('../backend/node_modules/mongoose');
const { mongoConfig } = require('../backend/src/config/mongoConfig');
(async () => {
  try {
    const config = mongoConfig();
    await mongoose.connect(config.uri, { dbName: config.dbName, authSource: config.authSource, serverSelectionTimeoutMS: 15000, autoIndex: false });
    const Lead = require('../backend/src/models/Lead');
    const Approval = require('../backend/src/models/PendingApproval');
    const leads = await Lead.find({ leadCode: 'ATPL-LEAD-0615' }).select('leadCode assignments.assignedServiceId assignments.poYearRows.poNumber assignments.poYearRows.poAmount serviceSelections.assignedServiceId serviceSelections.servicesOffered').lean();
    const approvals = await Approval.find({ type: 'purchase_order', uniqueId: 'ATPL-LEAD-0615' }).select('approvalStatus payload.leadId payload.assignedServiceId payload.poYearRows.poNumber payload.poYearRows.poAmount payload.poYearRows.quotationBasicAmount poReview.stage poReview.version poReview.poSummary.poNumber poReview.poSummary.poAmount updatedAt').lean();
    console.log(JSON.stringify({ leads, approvals }));
  } catch (error) { console.error(JSON.stringify({ error: error.name, code: error.code })); process.exitCode = 1; }
  finally { await mongoose.disconnect(); }
})();
