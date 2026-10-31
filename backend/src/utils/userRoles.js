function normalizeRole(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function getUserRoles(user = {}) {
  const values = [user.role, ...(Array.isArray(user.roles) ? user.roles : [])];
  return [...new Set(values.map(normalizeRole).filter(Boolean))];
}

function normalizeRoleFamily(value) {
  const family = normalizeRole(value).replace(/-/g, '');
  // The same operational role exists in saved data under both CCA and CAA
  // labels. Treat those labels, and the reversed CTO/CTE spelling, as one
  // permission family so secondary roles receive the same access.
  if (/^(?:ctecto|ctocte)(?:cca|caa)?$/.test(family)) return 'ctecto';
  return family;
}

function userHasAnyRole(user, allowedRoles = []) {
  const userRoles = getUserRoles(user).map(normalizeRoleFamily);
  const allowed = allowedRoles.map(normalizeRoleFamily);
  return userRoles.some((role) => allowed.includes(role) || (allowed.includes('compliance') && role.includes('compliance')));
}

module.exports = { getUserRoles, normalizeRole, userHasAnyRole };
