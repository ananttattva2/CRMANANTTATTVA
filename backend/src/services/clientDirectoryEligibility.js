const { closedPoClientFilter } = require('./clientClosedPoDirectory');
const { getCrmCache } = require('./crmCache');

async function clientDirectoryEligibilityFilter() {
  return getCrmCache().remember('client-directory-eligible-services:v1', () =>
    closedPoClientFilter(undefined, { requireStaff: true })
  );
}

module.exports = { clientDirectoryEligibilityFilter };
