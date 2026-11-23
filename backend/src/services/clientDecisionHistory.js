const mongoose = require('mongoose');
const Review = require('../models/ClientComplianceReview');
const User = require('../models/User');
const DECISION_ACTIONS = ['APPROVED', 'PARTIALLY_APPROVED', 'CHANGES_REQUIRED', 'REJECTED'];
async function readPreviousClientDecisions(records = [], { ReviewModel = Review, UserModel = User } = {}) {
  const ids = [...new Set(records.filter(record => !record.actionBy?.name && !record.actionBy?.email).map(record => String(record.sourceClientId || '')).filter(id => mongoose.isValidObjectId(id)))];
  if (!ids.length) return new Map();
  // Only the last submitted decision is read, never a section edit, an assigned
  // reviewer or the user who resubmitted corrected data.
  const reviews = await ReviewModel.aggregate([
    { $match: { client: { $in: ids.map(id => new mongoose.Types.ObjectId(id)) } } },
    { $project: { client: 1, lastDecision: { $arrayElemAt: [{ $filter: { input: { $ifNull: ['$history', []] }, as: 'event', cond: { $in: ['$$event.action', DECISION_ACTIONS] } } }, -1] } } }
  ]);
  const actors = [...new Set(reviews.map(review => String(review.lastDecision?.actionBy || '')).filter(id => mongoose.isValidObjectId(id)))];
  const users = actors.length ? await UserModel.find({ _id: { $in: actors } }).select('name email').lean() : [];
  const usersById = new Map(users.map(user => [String(user._id), user]));
  const result = new Map();
  for (const review of reviews) {
    const event = review.lastDecision, user = usersById.get(String(event?.actionBy || ''));
    if (event && user) result.set(String(review.client), { decisionBy: user.name || user.email || '-', decisionAt: event.actionAt || null });
  }
  return result;
}
module.exports = { readPreviousClientDecisions, DECISION_ACTIONS };
