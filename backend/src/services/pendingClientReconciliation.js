const text = value => String(value || '').trim();
const key = value => text(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const known = value => text(value) && text(value) !== '-';

// Resolve an unlabelled legacy application only when it has exactly one
// labelled counterpart. Never group clients just by their company name.
function reconcileLegacyPendingClients(rows = []) {
  const result = [...rows];
  const scope = row => [row.source || 'crm', row.clientName || row.companyName,
    row.eprCategory, row.piboCategory, row.assignedStaff].map(key).join('|');
  const plant = row => key(row.plantUnit || row.unitName);
  for (const legacy of rows.filter(row => !known(row.serviceOffered))) {
    const candidates = result.filter(row => row !== legacy && known(row.serviceOffered)
      && scope(row) === scope(legacy)
      && (!plant(row) || !plant(legacy) || plant(row) === plant(legacy))
      && known(row.clientName || row.companyName) && known(row.eprCategory) && known(row.assignedStaff)
      && (!row.selectedLeadId || !legacy.selectedLeadId || String(row.selectedLeadId) === String(legacy.selectedLeadId)));
    if (candidates.length !== 1) continue;
    const labelled = candidates[0];
    const hasDecision = row => known(row.decisionBy) && row.decisionAt;
    const decisions = [legacy, labelled].filter(hasDecision)
      .sort((a, b) => new Date(b.decisionAt) - new Date(a.decisionAt));
    const decision = decisions[0];
    // A newly created pending shell must not replace an actual compliance
    // decision. Explicit later submission, however, does reopen the review.
    const resubmitted = decision && [legacy, labelled].find(row => row.approvalStatus === 'PENDING'
      && row.submittedAt && new Date(row.submittedAt) > new Date(decision.decisionAt));
    const primary = resubmitted || decision || labelled;
    const merged = { ...labelled, ...primary, serviceOffered: labelled.serviceOffered };
    if (resubmitted) Object.assign(merged, {
      decisionBy: decision.decisionBy, decisionAt: decision.decisionAt,
      remarks: resubmitted.remarks || decision.remarks
    });
    result.splice(result.indexOf(labelled), 1, merged);
    const index = result.indexOf(legacy);
    if (index >= 0) result.splice(index, 1);
  }
  return result;
}
module.exports = { reconcileLegacyPendingClients };
