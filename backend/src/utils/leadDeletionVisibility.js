// Deleted leads retain their audit identity but are excluded from normal CRM reads.
function leadDeletionVisibility(schema) {
  schema.pre(['find', 'findOne', 'findOneAndUpdate', 'countDocuments', 'distinct', 'updateOne', 'updateMany'], function () {
    this.setQuery({ $and: [this.getFilter(), { deletedAt: null }] });
  });
  schema.pre('aggregate', function () {
    const pipeline = this.pipeline();
    const firstMustRemainFirst = pipeline[0]?.$geoNear || pipeline[0]?.$search || pipeline[0]?.$vectorSearch;
    pipeline.splice(firstMustRemainFirst ? 1 : 0, 0, { $match: { deletedAt: null } });
  });
}

module.exports = leadDeletionVisibility;
