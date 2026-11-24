/** Admin approval permits revision even while final management approval is pending. */
export function canReviseQuotation(row = {}) {
  const status = String(row.status || row.quotationStatus || '').trim().toLowerCase();
  const approvalStatus = String(row.approvalStatus || row.adminApproval || '').trim().toLowerCase();
  return ['approved', 'admin_approved', 'rejected'].includes(status)
    || ['approved', 'admin_approved', 'rejected'].includes(approvalStatus)
    || String(row.managementApproval?.adminApprovalStatus || '').toUpperCase() === 'APPROVED'
    || (String(row.approvalDecision?.approvalKind || '').toUpperCase() === 'ADMIN'
      && String(row.approvalDecision?.status || '').toUpperCase() === 'APPROVED');
}
