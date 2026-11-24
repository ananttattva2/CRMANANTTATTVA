export const CLIENT_APPROVAL_EXPORT_STATUSES = ['PENDING', 'PARTIALLY_APPROVED', 'APPROVED', 'REJECTED'];

const STATUS_LABELS = {
  PENDING: 'Pending',
  PARTIALLY_APPROVED: 'Partially Approved',
  APPROVED: 'Approved',
  REJECTED: 'Rejected'
};

function text(value, fallback = '-') {
  if (Array.isArray(value)) return value.map((item) => text(item, '')).filter(Boolean).join(', ') || fallback;
  if (value && typeof value === 'object') return text(value.name || value.fullName || value.email || value.username || value._id, fallback);
  return String(value ?? '').trim() || fallback;
}

function statusOf(row = {}) {
  return String(row.approvalStatus || row.status || 'PENDING').trim().toUpperCase();
}

function indiaDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return text(value);
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  }).format(date);
}

export function buildPendingClientApprovalExportRows(clients = []) {
  const statusOrder = new Map(CLIENT_APPROVAL_EXPORT_STATUSES.map((status, index) => [status, index]));
  return clients
    .filter((client) => statusOrder.has(statusOf(client)))
    .sort((left, right) => (statusOrder.get(statusOf(left)) - statusOrder.get(statusOf(right)))
      || text(left.clientName || left.companyName).localeCompare(text(right.clientName || right.companyName)))
    .map((client, index) => ({
      'Sr. No.': index + 1,
      'Client Name': text(client.clientName || client.companyName),
      'Approval Status': STATUS_LABELS[statusOf(client)] || statusOf(client),
      'User Name': text(client.createdBy || client.submittedBy || client.createdByName || client.userName),
      'Decision By': statusOf(client) === 'PENDING' ? '-' : text(client.decisionBy || client.actionBy),
      'Applicant Type': text(client.piboCategory || client.applicantType),
      'Service Category': text(client.eprCategory || client.serviceCategory),
      'Applicant Count': Number(client.applicantCount) || 1,
      'Request Date': [text(client.requestDate, ''), text(client.requestTime, '')].filter(Boolean).join(' ') || '-',
      'Decision Date': indiaDateTime(client.decisionAt || client.actionAt)
    }));
}

export function buildPendingClientApprovalSummary(clients = []) {
  return CLIENT_APPROVAL_EXPORT_STATUSES.map((status) => ({
    Status: STATUS_LABELS[status],
    Count: clients.filter((client) => statusOf(client) === status).length
  }));
}
