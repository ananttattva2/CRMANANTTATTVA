const {closedPoClientFilter}=require('./clientClosedPoDirectory');
const {savedClientDirectoryBranches}=require('./clientMasterVisibility');
// Existing Client Master data must remain accessible, including legacy records
// created before the Finance review workflow. Finance controls new assignments,
// not whether historical client data may be viewed or reviewed.
async function clientDirectoryEligibilityFilter(options={}) {
  const closed=await (options.closedPoFilter||closedPoClientFilter)();
  return {$or:[closed,...savedClientDirectoryBranches()]};
}
module.exports={clientDirectoryEligibilityFilter};
