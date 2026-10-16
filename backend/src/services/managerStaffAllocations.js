const { resolveClientMasterData } = require('./clientMasterResolver');
const normalize = input => String(input || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const offering = input => (Array.isArray(input) ? input : [input]).map(v => /annual(?:return(?:fill?ing)?|fill?ing)/.test(normalize(v)) ? 'annualreturn' : normalize(v)).sort().join('|');
const value = input => String(input?._id || input || '');
const applicant = input => {
  const key = normalize(input);
  if ((key.includes('rawmaterial') || key.includes('simp')) && key.includes('import')) return 'importerrawmaterial';
  if ((key.includes('smallmicro') || key.includes('simp')) && key.includes('produc')) return 'producersmallmicro';
  if (key.includes('brandowner')) return 'brandowner';
  if (key.includes('importer')) return 'importer';
  if (key.includes('producer')) return 'producer';
  if (key.includes('recycler')) return 'recycler';
  return key;
};
function clientMatchesService(client, services, service, serviceId) {
  const data = client.data || {};
  const selectedId = value(client.assignedServiceId || data.assignedServiceId || data.selectedLeadSnapshot?.assignedServiceId);
  if (selectedId && selectedId === serviceId) return true;
  const snapshot = data.selectedLeadSnapshot || {};
  const basic = data.basic || {};
  const selectedService = services.find(candidate => value(candidate.assignedServiceId || candidate.serviceAssignmentId) === selectedId);
  const profile = {
    category: applicant(selectedService?.subApplicantType || selectedService?.piboCategory || snapshot.subApplicantType || snapshot.piboCategory || basic.piboCategory || basic.subApplicantType),
    unit: normalize(selectedService?.plantUnit || snapshot.plantUnit || basic.plantUnit),
    epr: normalize(selectedService?.eprCategory || snapshot.eprCategory || basic.eprCategory),
    offered: offering(selectedService?.servicesOffered || selectedService?.applicableService || snapshot.servicesOffered || snapshot.applicableService || basic.servicesOffered || basic.applicableService)
  };
  const compatible = candidate => {
    const candidateProfile = {
      category: applicant(candidate.subApplicantType || candidate.piboCategory),
      unit: normalize(candidate.plantUnit),
      epr: normalize(candidate.eprCategory),
      offered: offering(candidate.servicesOffered || candidate.applicableService)
    };
    let compared = 0;
    for (const field of ['category', 'unit', 'epr', 'offered']) {
      if (!profile[field] || !candidateProfile[field]) continue;
      compared += 1;
      if (profile[field] !== candidateProfile[field]) return false;
    }
    return compared > 0;
  };
  // Two current assignments with the same applicant/unit/service signature
  // represent the same CPCB application context, so a saved status may be
  // shared between them even when their generated assignment ids differ.
  if (selectedService) return compatible(service);
  // Legacy drafts can retain an obsolete service id. In that case use their
  // saved applicant/unit/service details only when they identify one current
  // service unambiguously, preventing CPCB status leakage to sibling services.
  const compatibleServices = services.filter(compatible);
  return compatibleServices.length === 1
    && value(compatibleServices[0].assignedServiceId || compatibleServices[0].serviceAssignmentId) === serviceId;
}
function clientMatchesLead(client, lead) {
  const data = client.data || {};
  const snapshot = data.selectedLeadSnapshot || {};
  const leadKeys = [lead._id, lead.sourceLeadId, lead.leadCode].map(value).filter(Boolean);
  const clientKeys = [client.selectedLead, data.selectedLead, snapshot.id, snapshot.sourceLeadId, snapshot.leadCode, data.importMeta?.leadNumber].map(value).filter(Boolean);
  return clientKeys.some(key => leadKeys.includes(key));
}
function dashboardStatusClient(client) {
  const resolved = resolveClientMasterData(client);
  const statusOnly = source => Object.fromEntries(['status', 'approvalStatus', 'applicationStatus']
    .map(key => [key, source?.[key]]).filter(([, status]) => status !== undefined));
  const sanitizeScopes = scopes => Object.fromEntries(Object.entries(scopes || {}).map(([key, scope]) => {
    const direct = statusOnly(scope);
    const cpcb = statusOnly(scope?.cpcb || scope?.details || scope);
    return [key, { ...direct, ...(Object.keys(cpcb).length ? { cpcb } : {}) }];
  }));
  // A legacy Client Master can contain CPCB states for several services.
  // Preserve only those status fields so the dashboard can resolve each row
  // without exposing credentials, documents or other private CPCB details.
  const directCpcb = statusOnly(client.data?.cpcb);
  const data = {
    ...client.data,
    // Keep a directly saved edit when present. Service resolution below only
    // applies it to the matching applicant/unit/service, never to siblings.
    cpcb: Object.keys(directCpcb).length ? directCpcb : statusOnly(resolved.cpcb),
    cpcbDataByAssignedServiceId: sanitizeScopes(client.data?.cpcbDataByAssignedServiceId),
    serviceDetailsByAssignedServiceId: sanitizeScopes(client.data?.serviceDetailsByAssignedServiceId)
  };
  return { ...client, data };
}
function scopedCpcbStatus(client, services, service, serviceId) {
  const data = client.data || {};
  const compatible = clientMatchesService(client, services, service, serviceId);
  const directStatus = data.cpcb?.status || data.cpcb?.approvalStatus || data.cpcb?.applicationStatus || '';
  for (const scope of [data.cpcbDataByAssignedServiceId?.[serviceId], data.serviceDetailsByAssignedServiceId?.[serviceId]]) {
    const exact = scope?.cpcb || scope?.details || scope;
    const status = exact?.status || exact?.approvalStatus || exact?.applicationStatus;
    // Legacy saves could update the matching root CPCB field without updating
    // an older Not Started service snapshot. Prefer the meaningful root edit
    // only for the same service; an exact non-default status stays authoritative.
    const defaultStatus = /^(notstarted|notrecorded|pending)?$/.test(normalize(status));
    if (status) {
      if (compatible && directStatus && defaultStatus && !/^(notstarted|notrecorded|pending)$/.test(normalize(directStatus))) {
        return { status: directStatus, exact: true };
      }
      return { status, exact: true };
    }
  }
  if (!compatible) return null;
  // A directly saved status belongs to this service when the Client Master
  // fingerprint matches it. Treat it as exact so a newer edit can outrank an
  // older migrated Not Started scope from a duplicate Client Master.
  if (directStatus && !/^(notstarted|notrecorded|pending)$/.test(normalize(directStatus))) {
    return { status: directStatus, exact: true };
  }
  const selectedId = client.assignedServiceId || data.assignedServiceId || data.selectedLeadSnapshot?.assignedServiceId;
  const resolved = resolveClientMasterData(client, selectedId);
  const status = resolved.cpcb?.status || resolved.cpcb?.approvalStatus || resolved.cpcb?.applicationStatus || '';
  return status ? { status, exact: false } : null;
}
// Count permanent staff assignments per lead service, including services whose Client Master is not created yet.
function mergeManagerStaffAllocations(clients = [], leads = []) {
  const linked = new Set();
  const result = [];
  for (const client of clients) {
    const leadId = value(client.selectedLead || client.data?.selectedLeadSnapshot?.id);
    const serviceId = client.assignedServiceId || client.data?.selectedLeadSnapshot?.assignedServiceId || '';
    const key = leadId && serviceId ? `${leadId}:${serviceId}` : `client:${value(client._id)}`;
    if (linked.has(key)) continue;
    // A draft Client Master is not a dashboard application and must not hide
    // the closed/permanently assigned lead-service placeholder created below.
    // Keep the draft available for editing, but only a non-draft master can
    // satisfy the lead/service link.
    const clientStatus = normalize(client.workflowStatus || client.data?.importMeta?.clientStatus);
    if (clientStatus !== 'draft') linked.add(key);
    result.push(client);
  }
  for (const lead of leads) {
    const services = lead.serviceSelections || [];
    (lead.assignments || []).forEach((assignment, index) => {
      const permanentOwner = assignment.assignedStaff || assignment.assignedStaffText || assignment.assignedStaffEmail;
      const legacyClosedOwner = (assignment.closedAt || assignment.closedBy || assignment.closedByText || assignment.permanentClosedAt)
        && (assignment.closedBy || assignment.closedByText || assignment.closedByEmail);
      if (!permanentOwner && !legacyClosedOwner) return;
      const serviceId = value(assignment.assignedServiceId || assignment.serviceAssignmentId || services[index]?.assignedServiceId || services[index]?.serviceAssignmentId || `assignment-${index}`);
      const key = `${value(lead._id)}:${serviceId}`;
      const alreadyLinked = linked.has(key);
      if (!alreadyLinked) linked.add(key);
      const service = services.find(s => value(s.assignedServiceId || s.serviceAssignmentId) === serviceId) || services[index] || {};
      const signature = row => [row.subApplicantType || row.piboCategory, row.plantUnit, row.eprCategory, offering(row.servicesOffered)].map(normalize).join(':');
      const matchingAssignments = (lead.assignments || []).flatMap((candidate, candidateIndex) => {
        const candidateId = value(candidate.assignedServiceId || candidate.serviceAssignmentId || services[candidateIndex]?.assignedServiceId || services[candidateIndex]?.serviceAssignmentId || `assignment-${candidateIndex}`);
        const candidateService = services.find(s => value(s.assignedServiceId || s.serviceAssignmentId) === candidateId) || services[candidateIndex] || {};
        return signature(candidateService) === signature(service)
          ? [{ ...candidate, assignedServiceId: candidateId }]
          : [];
      });
      const matchingPoRows = matchingAssignments.flatMap(candidate => [
        ...(Array.isArray(candidate.poYearRows) ? candidate.poYearRows : []),
        ...(candidate.originalPoDetails ? [candidate.originalPoDetails] : [])
      ]);
      const enrichedAssignment = {
        ...assignment,
        assignedServiceId: serviceId,
        ...(matchingPoRows.length ? { poYearRows: matchingPoRows } : {}),
        ...(matchingAssignments.some(candidate => normalize(candidate.poStatus) === 'received') ? { poStatus: 'received' } : {})
      };
      const matchingMasters = clients.flatMap(client => {
        if (!clientMatchesLead(client, lead)) return [];
        const match = scopedCpcbStatus(client, services, service, serviceId);
        return match ? [{ client, ...match }] : [];
      }).sort((a, b) => Number(b.exact) - Number(a.exact)
        || new Date(b.client.updatedAt || b.client.submittedAt || b.client.createdAt || 0) - new Date(a.client.updatedAt || a.client.submittedAt || a.client.createdAt || 0));
      // Drafts are not applications, but the CPCB form is saved while the
      // Client Master is still a draft. Use the newest matching record only as
      // a status source; use a non-draft record for application workflow data.
      const statusMatch = matchingMasters[0];
      const statusMaster = statusMatch?.client;
      const workflowMaster = matchingMasters.map(match => match.client).find(client => normalize(client.workflowStatus || client.data?.importMeta?.clientStatus) !== 'draft');
      if (alreadyLinked) {
        // The submitted Client Master remains the dashboard application, but a
        // newer matching draft/edit can carry the latest CPCB decision. Apply
        // that status to the retained read model instead of leaving its older
        // Not Started snapshot visible.
        if (statusMatch?.status) {
          const applicationIndex = result.findIndex(item => {
            const itemLeadId = value(item.selectedLead || item.data?.selectedLeadSnapshot?.id);
            const itemServiceId = value(item.assignedServiceId || item.data?.assignedServiceId || item.data?.selectedLeadSnapshot?.assignedServiceId);
            return `${itemLeadId}:${itemServiceId}` === key
              && normalize(item.workflowStatus || item.data?.importMeta?.clientStatus) !== 'draft';
          });
          if (applicationIndex >= 0) {
            const application = result[applicationIndex];
            result[applicationIndex] = {
              ...application,
              data: { ...(application.data || {}), cpcb: { ...(application.data?.cpcb || {}), status: statusMatch.status } }
            };
          }
        }
        return;
      }
      const masterData = statusMaster ? resolveClientMasterData(statusMaster) : {};
      result.push({ _id: `assignment:${key}`, assignedServiceId: serviceId,
        statusSourceClientId: statusMaster ? value(statusMaster._id) : undefined,
        workflowStatus: workflowMaster?.workflowStatus,
        selectedLead: { ...lead, assignments: [enrichedAssignment], serviceSelections: [service] },
        data: { cpcb: statusMatch?.status ? { status: statusMatch.status } : {}, registeredAddress: masterData.registeredAddress?.state ? { state: masterData.registeredAddress.state } : {}, basic: { clientLegalName: lead.company || lead.companyName || lead.clientName || 'Untitled client' }, importMeta: { leadNumber: lead.leadCode || lead.sourceLeadId || '' } },
        adminControls: { visibilityStatus: (workflowMaster || statusMaster)?.adminControls?.visibilityStatus }, sla: {}, assignmentOnly: true
      });
    });
  }
  return result;
}
module.exports = { mergeManagerStaffAllocations, dashboardStatusClient };
