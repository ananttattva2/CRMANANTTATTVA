const { closedPoClientFilter } = require('./clientClosedPoDirectory');

async function clientDirectoryEligibilityFilter() {
  return closedPoClientFilter(undefined, { requireStaff: true });
}

module.exports = { clientDirectoryEligibilityFilter };
