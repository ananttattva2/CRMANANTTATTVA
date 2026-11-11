function identity(value) {
  return String(value?._id || value || '').trim();
}

function managerAssignmentTimestamp(previous = {}, next = {}, now = new Date()) {
  const nextManagerId = identity(next.assignedTo);
  if (!nextManagerId) return '';
  if (nextManagerId !== identity(previous.assignedTo)) return now.toISOString();
  return String(previous.managerAssignedAt || '').trim();
}

module.exports = { managerAssignmentTimestamp };
