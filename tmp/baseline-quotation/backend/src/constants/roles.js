const ROLES = ['operation', 'admin', 'superadmin', 'manager', 'compliance', 'sales', 'accounts', 'cte-cto'];
const ADMIN_ROLES = ['admin', 'superadmin'];
const CLIENT_APPROVAL_ROLES = [...ADMIN_ROLES, 'compliance'];

module.exports = { ROLES, ADMIN_ROLES, CLIENT_APPROVAL_ROLES };
