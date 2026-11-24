export function canApprovePo(status) {
  return ['PENDING', 'REJECTED', 'REVISION_REQUIRED'].includes(String(status || '').toUpperCase())
}

export function canReviewPoDecision(currentStatus, nextStatus) {
  return String(currentStatus || '').toUpperCase() === 'PENDING'
    || (nextStatus === 'APPROVED' && canApprovePo(currentStatus))
}
