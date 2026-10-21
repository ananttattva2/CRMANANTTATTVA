function clientMasterSourceRecordFilter() {
  return {
    $or: [
      { 'data.importMeta.approvalOverride': { $ne: true } },
      // Older approval decisions accidentally marked the real Client Master as
      // an approval override. A real source record still has one of these
      // top-level service links; an approval-only shadow does not.
      { selectedLead: { $exists: true, $ne: null } },
      { assignedServiceId: { $exists: true, $nin: ['', null] } }
    ]
  };
}

module.exports = { clientMasterSourceRecordFilter };
