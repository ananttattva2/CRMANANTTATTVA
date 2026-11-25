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

// A saved Client Master is useful before PO closure as well. Match actual
// user-entered records, without adding empty lead placeholders to the directory.
function savedClientDirectoryBranches() {
  return [
    { workflowStatus: 'submitted' },
    { 'data.cte.plantWiseDetails.0': { $exists: true } },
    { 'data.compliance.pan': { $exists: true, $nin: ['', null] } }
  ];
}
module.exports = { clientMasterSourceRecordFilter, savedClientDirectoryBranches };
