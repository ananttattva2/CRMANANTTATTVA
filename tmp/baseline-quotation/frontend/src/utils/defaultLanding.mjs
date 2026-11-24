const normalizedRoles = (user = {}) => [user?.role, ...(Array.isArray(user?.roles) ? user.roles : [])]
  .map(value => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ''))
  .filter(Boolean);

export function isSummaryDashboardAdmin(user) {
  return normalizedRoles(user).some(role => role === 'admin' || role === 'superadmin');
}

export function defaultLandingPath(user) {
  return isSummaryDashboardAdmin(user) ? '/summary-dashboard' : '/overall-dashboard';
}

