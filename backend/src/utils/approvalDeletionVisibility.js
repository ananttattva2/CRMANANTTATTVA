function approvalDeletionVisibility(schema) {
  schema.pre(['find', 'findOne', 'findOneAndUpdate', 'countDocuments', 'distinct', 'updateOne', 'updateMany'], function () {
    // Saving a lead again may upsert the same approval source. Match its
    // archived row without recreating it or clearing the removal marker.
    if (this.getOptions().upsert) return;
    this.setQuery({ $and: [this.getFilter(), { deletedAt: null }] });
  });
  schema.pre('aggregate', function () {
    const pipeline = this.pipeline();
    const first = pipeline[0];
    pipeline.splice(first?.$geoNear || first?.$search || first?.$vectorSearch ? 1 : 0, 0, { $match: { deletedAt: null } });
  });
}
module.exports = approvalDeletionVisibility;
