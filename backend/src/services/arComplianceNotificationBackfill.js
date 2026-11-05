const Review = require('../models/ArComplianceReview');
const Client = require('../models/Client');
const { notifyArComplianceDecision } = require('./arComplianceDecisionNotifications');

async function runArComplianceApprovalNotificationBackfill() {
  const reviews = await Review.find({
    managerStatus: 'APPROVED',
    status: { $in: ['PENDING', 'IN_REVIEW'] }
  }).select('client financialYear managerFinalRemarks managerDecidedBy managerDecidedByName managerDecidedAt managerSourceFingerprint managerSourceRevision status').populate('managerDecidedBy', 'name email').sort({ managerDecidedAt: 1, _id: 1 }).lean();
  if (!reviews.length) return { scanned: 0, sent: 0, skipped: 0, failed: 0 };

  const clients = await Client.find({ _id: { $in: reviews.map((review) => review.client) } })
    .select('data.basic selectedLead')
    .populate('selectedLead', 'company leadCode')
    .lean();
  const clientById = new Map(clients.map((client) => [String(client._id), client]));
  const summary = { scanned: reviews.length, sent: 0, skipped: 0, failed: 0 };

  for (const review of reviews) {
    const client = clientById.get(String(review.client));
    if (!client) {
      summary.failed += 1;
      continue;
    }
    const actor = review.managerDecidedBy || {
      _id: undefined,
      name: review.managerDecidedByName || 'Manager'
    };
    const eventKey = review.managerSourceFingerprint
      || review.managerSourceRevision
      || review.managerDecidedAt?.toISOString?.()
      || String(review._id);
    try {
      const result = await notifyArComplianceDecision({
        client,
        financialYear: review.financialYear,
        stage: 'manager',
        decision: 'APPROVED',
        remarks: review.managerFinalRemarks || 'Manager approved this Annual Return review.',
        actor,
        eventKey,
        preventDuplicate: true
      });
      if (result?.skipped) summary.skipped += 1;
      else if (result?.ok) summary.sent += 1;
      else summary.failed += 1;
    } catch (error) {
      summary.failed += 1;
      console.error('Existing AR Manager approval notification failed', {
        reviewId: String(review._id),
        clientId: String(review.client),
        financialYear: review.financialYear,
        error: error.message
      });
    }
  }
  if (summary.sent || summary.failed) console.info('AR Manager approval notification backfill completed', summary);
  return summary;
}

module.exports = { runArComplianceApprovalNotificationBackfill };
