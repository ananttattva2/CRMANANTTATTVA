import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  BriefcaseBusiness,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  CircleAlert,
  ClipboardList,
  Database,
  Filter,
  Gauge,
  ListChecks,
  MapPin,
  Percent,
  Phone,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  UserCheck,
  UserPlus,
  Users,
  X
} from 'lucide-react';
import DashboardShell from '../components/dashboard/DashboardShell';
import ProfileModal from '../components/dashboard/ProfileModal';
import api, { API_ENDPOINTS } from '../services/api';
import { adminRoles, roleLabels } from '../constants/dashboard';

function clientMasterGroupingIdentityForAllocation({ applicantType = '', subApplicantType = '', plantUnit = '', eprCategory = '', piboCategory = '', servicesOffered = '', servicePeriod = '', financialYear = '', applicantLabel = '' }) {
  const clean = (v = '') => String(v || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const tuple = [
    clean(applicantType),
    clean(subApplicantType),
    clean(plantUnit),
    clean(eprCategory),
    clean(piboCategory),
    clean(servicesOffered),
    clean(servicePeriod),
    clean(financialYear),
    clean(applicantLabel)
  ];
  return tuple.filter(Boolean).join('::');
}

function splitAllocationKeyToTuple(key) {
  if (!key || typeof key !== 'string') return Array(9).fill('');
  const arr = String(key).split('::').map((p) => String(p || '').trim().toLowerCase().replace(/[^a-z0-9]/g, ''));
  while (arr.length < 9) arr.push('');
  return arr.slice(0, 9);
}

function normalizeAllocationKeyString(key) {
  return splitAllocationKeyToTuple(key).filter(Boolean).join('::');
}

function findAllocationEntry({ svc, idx, servicesAllocs }) {
  const allocs = (servicesAllocs && typeof servicesAllocs === 'object')
    ? (servicesAllocs.toObject ? servicesAllocs.toObject() : servicesAllocs)
    : {};
  const key9 = splitAllocationKeyToTuple(clientMasterGroupingIdentityForAllocation({
    applicantType: svc?.applicantType,
    subApplicantType: svc?.piboCategory,
    plantUnit: svc?.plantUnit,
    eprCategory: svc?.eprCategory || svc?.serviceCategory,
    piboCategory: svc?.piboCategory,
    servicesOffered: svc?.servicesOffered,
    financialYear: svc?.financialYear
  }));
  const normExactKey = key9.filter(Boolean).join('::');
  const allocEntries = Object.entries(allocs);

  // 1) Exact normalized match
  if (normExactKey) {
    for (const [k, v] of allocEntries) {
      const normK = normalizeAllocationKeyString(k);
      if (normK && normK === normExactKey) return { key: k, rawEntry: v, matchKind: 'normalized-exact' };
    }
  }

  // 2) Fuzzy tuple component match (≥ 70% of non-empty parts are equal)
  const nonEmptyIdx = key9.map((p, i) => p ? i : -1).filter((i) => i >= 0);
  if (nonEmptyIdx.length) {
    let bestMatch = null;
    let bestScore = 0;
    for (const [k, v] of allocEntries) {
      const k9 = splitAllocationKeyToTuple(k);
      let same = 0;
      nonEmptyIdx.forEach((i) => { if (k9[i] === key9[i]) same += 1; });
      const score = same / nonEmptyIdx.length;
      if (score >= 0.7 && score > bestScore) { bestScore = score; bestMatch = { key: k, rawEntry: v, matchKind: `fuzzy-${Math.round(score * 100)}` }; }
    }
    if (bestMatch) return bestMatch;
  }

  // 3) Legacy fallbacks: assignedServiceId or numeric idx key
  const legacyKey = String(svc?.assignedServiceId || idx || '');
  if (legacyKey && allocs[legacyKey]) return { key: legacyKey, rawEntry: allocs[legacyKey], matchKind: 'legacy-id' };
  if (allocs[idx]) return { key: String(idx), rawEntry: allocs[idx], matchKind: 'legacy-index' };
  return { key: null, rawEntry: null, matchKind: 'none' };
}

function allocationEntryUserId(entry) {
  if (entry == null) return '';
  if (typeof entry === 'string' || typeof entry === 'number') {
    const s = String(entry || '').trim();
    if (!s) return '';
    const m = s.match(/[a-f0-9]{24}/i);
    return m ? m[0] : s;
  }
  const v = entry && typeof entry === 'object' ? entry : {};
  const raw = v?.userId || v?.user || v?.assignedTo || v?.uid || v?.assigneeId || v?.assignee_id || v?.assignedUserId || v?.id || v?._id || v?.value || v?.__uid || '';
  if (raw == null) return '';
  if (typeof raw === 'object') {
    const id = String(raw?._id || raw?.id || raw?.$oid || raw || '').trim();
    return id && id !== '[object Object]' ? id : '';
  }
  const s = String(raw || '').trim();
  if (!s) return '';
  const m = s.match(/[a-f0-9]{24}/i);
  return m ? m[0] : s;
}

function allocationEntryAssignedName(entry) {
  const v = entry && typeof entry === 'object' ? entry : {};
  return String(v?.assignedByName || v?.assignedToName || v?.userName || v?.name || v?.assigneeName || '').trim();
}

function extractServicesFromClient(client = {}) {
  const data = client.data || {};
  const rawServices = Array.isArray(client.services) ? client.services : [];
  const serviceMap = new Map();
  const services = rawServices.length ? rawServices.map((s) => {
    const serviceData = (s && typeof s === 'object') ? s : {};
    return Object.assign({}, serviceData, {
      applicantType: serviceData.applicantType || serviceData.piboParent || data.selectedLeadSnapshot?.applicantType || data.selectedLeadSnapshot?.piboParent || data.selectedLeadSnapshot?.piboCategoryParent || '',
      subApplicantType: serviceData.piboCategory || data.selectedLeadSnapshot?.subApplicantType || data.basic?.piboCategory || data.selectedLeadSnapshot?.piboCategory || serviceData.subApplicantType || '',
      servicesOffered: serviceData.servicesOffered || data.selectedLeadSnapshot?.servicesOffered || data.basic?.servicesOffered || '',
      eprCategory: serviceData.eprCategory || data.selectedLeadSnapshot?.eprCategory || data.basic?.eprCategory || serviceData.serviceCategory || '',
      financialYear: serviceData.financialYear || serviceData.servicesForYear || (Array.isArray(serviceData.annualReturnYears) ? serviceData.annualReturnYears[0] : '') || '',
      plantUnit: serviceData.plantUnit || data.selectedLeadSnapshot?.plantUnit || data.basic?.plantUnit || '',
      piboParent: serviceData.piboParent || serviceData.applicantType || data.selectedLeadSnapshot?.piboParent || '',
      piboCategory: serviceData.piboCategory || serviceData.subApplicantType || data.selectedLeadSnapshot?.piboCategory || data.basic?.piboCategory || '',
      assignedServiceId: serviceData.assignedServiceId || data.assignedServiceId || client.assignedServiceId || '',
      serviceCategory: serviceData.serviceCategory || serviceData.eprCategory || data.selectedLeadSnapshot?.eprCategory || data.basic?.eprCategory || ''
    });
  }) : [];
  if (services.length) {
    services.forEach((svc) => {
      const key = clientMasterGroupingIdentityForAllocation({ applicantType: svc.applicantType, subApplicantType: svc.piboCategory, plantUnit: svc.plantUnit, eprCategory: svc.eprCategory || svc.serviceCategory, servicesOffered: svc.servicesOffered, financialYear: svc.financialYear, piboCategory: svc.piboCategory });
      if (!serviceMap.has(key)) serviceMap.set(key, svc);
    });
    return Array.from(serviceMap.values());
  }
  if (data.selectedLeadSnapshot || data.basic || client.applicantType || client.servicesOffered) {
    const synthetic = {
      applicantType: data.selectedLeadSnapshot?.applicantType || data.selectedLeadSnapshot?.piboParent || client.applicantType || client.piboParent || '',
      subApplicantType: data.selectedLeadSnapshot?.subApplicantType || data.basic?.piboCategory || client.piboCategory || '',
      eprCategory: data.selectedLeadSnapshot?.eprCategory || data.basic?.eprCategory || client.eprCategory || '',
      piboCategory: data.basic?.piboCategory || data.selectedLeadSnapshot?.piboCategory || client.piboCategory || '',
      servicesOffered: data.selectedLeadSnapshot?.servicesOffered || data.basic?.servicesOffered || client.servicesOffered || '',
      plantUnit: data.selectedLeadSnapshot?.plantUnit || data.basic?.plantUnit || '',
      financialYear: data.selectedLeadSnapshot?.financialYear || data.basic?.onboardingYear || '',
      assignedServiceId: data.assignedServiceId || client.assignedServiceId || '',
      serviceCategory: data.selectedLeadSnapshot?.serviceCategory || data.selectedLeadSnapshot?.eprCategory || data.basic?.eprCategory || client.eprCategory || ''
    };
    return [synthetic];
  }
  return [];
}

function readClientOverview(client = {}) {
  const data = client.data || {};
  const snap = data.selectedLeadSnapshot || {};
  const basic = data.basic || {};
  const overview = data.companyOverview || {};
  const contact = data.authorisedContact || data.authorizedContact || {};
  const lead = client.selectedLead || {};
  const companyName = basic.clientLegalName || basic.tradeName || data.importMeta?.companyName || snap.companyName || client.companyName || overview.companyName || lead.company || '—';
  const contactPerson = basic.contactPerson || contact.contactPerson || snap.contactPerson || client.contactPerson || lead.contactPerson || '';
  const mobile = basic.mobileNo || contact.mobile || basic.mobileNo1 || basic.mobile || snap.mobileNo1 || lead.mobile || '';
  const email = basic.emailId || contact.email || basic.email || snap.email || lead.email || '';
  const gstin = basic.gstNumber || snap.gstNumber || data.importMeta?.gstNumber || '';
  const state = basic.state || snap.state || lead.state || '';
  const city = basic.city || snap.city || lead.city || '';
  const leadCode = String(data.importMeta?.leadNumber || snap.leadCode || lead.leadCode || client.uniqueId || '').trim();
  return { companyName, contactPerson, mobile, email, gstin, state, city, leadCode };
}

function clientAllocationGroupIdentity(client = {}) {
  const selectedLead = client.selectedLead;
  const selectedLeadId = typeof selectedLead === 'object'
    ? String(selectedLead?._id || selectedLead?.id || '').trim()
    : String(selectedLead || '').trim();
  if (selectedLeadId) return `lead:${selectedLeadId.toLowerCase()}`;
  const overview = readClientOverview(client);
  if (overview.leadCode) return `code:${overview.leadCode.toLowerCase()}`;
  const data = client.data || {};
  const importedLeadId = String(data.importMeta?.leadId || data.selectedLeadSnapshot?.leadId || '').trim();
  if (importedLeadId) return `lead:${importedLeadId.toLowerCase()}`;
  return `client:${String(client._id || client.id || '').trim().toLowerCase()}`;
}

function deduplicateClientMastersForAllocation(clients = []) {
  const byIdentity = new Map();
  clients.forEach((client) => {
    const identity = clientAllocationGroupIdentity(client);
    const current = byIdentity.get(identity);
    if (!current) {
      byIdentity.set(identity, client);
      return;
    }
    const currentServiceCount = extractServicesFromClient(current).length;
    const nextServiceCount = extractServicesFromClient(client).length;
    if (nextServiceCount > currentServiceCount) byIdentity.set(identity, client);
  });
  return Array.from(byIdentity.values());
}

function allocationKeyForService(svc = {}, idx = 0) {
  return clientMasterGroupingIdentityForAllocation({
    applicantType: svc.applicantType, subApplicantType: svc.piboCategory, plantUnit: svc.plantUnit,
    eprCategory: svc.eprCategory || svc.serviceCategory, servicesOffered: svc.servicesOffered,
    financialYear: svc.financialYear, piboCategory: svc.piboCategory
  }) || `fallback_${idx}`;
}

function allocationStateKey(clientId, serviceKey) {
  return `${String(clientId || '').trim()}@@${serviceKey}`;
}

function userDisplay(u) {
  const roleRaw = u ? u.role : '';
  const roleLabel = roleLabels[String(roleRaw || '').toLowerCase()] || String(roleRaw || '').trim();
  const roleText = String(roleLabel || '').toLowerCase().replace(/[\s_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const name = u ? (u.name || `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email || 'Unknown') : 'Unknown';
  return roleText ? `${name} · ${roleText}` : name;
}

function userMiniDisplay(u) {
  return u ? (u.name || `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email || 'Unknown') : 'Unknown';
}

const APPLICANT_THEMES = {
  producer: { ring: 'ring-emerald-200/80', iconBg: 'bg-gradient-to-br from-emerald-500 to-teal-500', badgeBg: 'bg-emerald-50', badgeText: 'text-emerald-800', badgeRing: 'ring-1 ring-emerald-200', softBg: 'bg-emerald-50/60', accentIcon: Building2 },
  brand: { ring: 'ring-sky-200/80', iconBg: 'bg-gradient-to-br from-sky-500 to-indigo-500', badgeBg: 'bg-sky-50', badgeText: 'text-sky-800', badgeRing: 'ring-1 ring-sky-200', softBg: 'bg-sky-50/60', accentIcon: Sparkles },
  'brand owner': { ring: 'ring-sky-200/80', iconBg: 'bg-gradient-to-br from-sky-500 to-indigo-500', badgeBg: 'bg-sky-50', badgeText: 'text-sky-800', badgeRing: 'ring-1 ring-sky-200', softBg: 'bg-sky-50/60', accentIcon: Sparkles },
  importer: { ring: 'ring-amber-200/80', iconBg: 'bg-gradient-to-br from-amber-500 to-orange-500', badgeBg: 'bg-amber-50', badgeText: 'text-amber-800', badgeRing: 'ring-1 ring-amber-200', softBg: 'bg-amber-50/60', accentIcon: ClipboardList },
  recycler: { ring: 'ring-teal-200/80', iconBg: 'bg-gradient-to-br from-teal-500 to-cyan-500', badgeBg: 'bg-teal-50', badgeText: 'text-teal-800', badgeRing: 'ring-1 ring-teal-200', softBg: 'bg-teal-50/60', accentIcon: ShieldCheck },
  'recycler processor': { ring: 'ring-teal-200/80', iconBg: 'bg-gradient-to-br from-teal-500 to-cyan-500', badgeBg: 'bg-teal-50', badgeText: 'text-teal-800', badgeRing: 'ring-1 ring-teal-200', softBg: 'bg-teal-50/60', accentIcon: ShieldCheck },
  'plastic waste recycler': { ring: 'ring-teal-200/80', iconBg: 'bg-gradient-to-br from-teal-500 to-cyan-500', badgeBg: 'bg-teal-50', badgeText: 'text-teal-800', badgeRing: 'ring-1 ring-teal-200', softBg: 'bg-teal-50/60', accentIcon: ShieldCheck },
  'tyre waste recycler': { ring: 'ring-rose-200/80', iconBg: 'bg-gradient-to-br from-rose-500 to-pink-500', badgeBg: 'bg-rose-50', badgeText: 'text-rose-800', badgeRing: 'ring-1 ring-rose-200', softBg: 'bg-rose-50/60', accentIcon: ShieldCheck },
  'e-waste recycler': { ring: 'ring-violet-200/80', iconBg: 'bg-gradient-to-br from-violet-500 to-fuchsia-500', badgeBg: 'bg-violet-50', badgeText: 'text-violet-800', badgeRing: 'ring-1 ring-violet-200', softBg: 'bg-violet-50/60', accentIcon: ShieldCheck },
  default: { ring: 'ring-slate-200/80', iconBg: 'bg-gradient-to-br from-slate-500 to-slate-700', badgeBg: 'bg-slate-50', badgeText: 'text-slate-800', badgeRing: 'ring-1 ring-slate-200', softBg: 'bg-slate-50/60', accentIcon: BriefcaseBusiness }
};

function getApplicantTheme(labelRaw = '') {
  const key = String(labelRaw || '').trim().toLowerCase();
  if (APPLICANT_THEMES[key]) return APPLICANT_THEMES[key];
  if (key.includes('brand')) return APPLICANT_THEMES.brand;
  if (key.includes('producer')) return APPLICANT_THEMES.producer;
  if (key.includes('import')) return APPLICANT_THEMES.importer;
  if (key.includes('recycl') || key.includes('processor')) {
    if (key.includes('tyre')) return APPLICANT_THEMES['tyre waste recycler'];
    if (key.includes('e-waste') || key.includes('ewaste') || key.includes('electronic')) return APPLICANT_THEMES['e-waste recycler'];
    return APPLICANT_THEMES.recycler;
  }
  return APPLICANT_THEMES.default;
}

function allocationsForClient(client) {
  let services = extractServicesFromClient(client);
  const allocs = (client.serviceAllocations && typeof client.serviceAllocations === 'object')
    ? (client.serviceAllocations.toObject ? client.serviceAllocations.toObject() : client.serviceAllocations)
    : {};
  const allocKeys = Object.keys(allocs || {});
  // If services list empty but allocations exist -> treat allocations slots as synthetic services so display works
  if (services.length === 0 && allocKeys.length) {
    services = allocKeys.map((k) => ({
      applicantType: k.split('::')[0] || 'Service',
      piboCategory: k.split('::')[1] || 'Service',
      eprCategory: k.split('::')[2] || '',
      financialYear: k.split('::')[3] || '',
      plantUnit: k.split('::')[4] || '',
      servicesOffered: k.split('::')[5] || '',
      serviceCategory: k.split('::')[2] || '',
      __allocSynthetic: true, __allocKey: k
    }));
  }
  let assigned = 0;
  services.forEach((svc, idx) => {
    const match = svc.__allocKey ? { key: svc.__allocKey, rawEntry: allocs[svc.__allocKey], matchKind: 'synthetic' } : findAllocationEntry({ svc, idx, servicesAllocs: allocs });
    const uid = allocationEntryUserId(match.rawEntry);
    if (uid) assigned += 1;
  });
  return { services, total: services.length, assigned, unassigned: services.length - assigned, _debugAllocs: allocKeys.length };
}

function allocationOverviewWithAssignees(client, users) {
  let services = extractServicesFromClient(client);
  const allocs = (client.serviceAllocations && typeof client.serviceAllocations === 'object')
    ? (client.serviceAllocations.toObject ? client.serviceAllocations.toObject() : client.serviceAllocations)
    : {};
  const allocKeys = Object.keys(allocs || {});
  if (services.length === 0 && allocKeys.length) {
    services = allocKeys.map((k) => ({
      applicantType: k.split('::')[0] || 'Service',
      piboCategory: k.split('::')[1] || 'Service',
      eprCategory: k.split('::')[2] || '',
      financialYear: k.split('::')[3] || '',
      plantUnit: k.split('::')[4] || '',
      servicesOffered: k.split('::')[5] || '',
      serviceCategory: k.split('::')[2] || '',
      __allocSynthetic: true, __allocKey: k
    }));
  }
  const userById = new Map((users || []).map((u) => [String(u?._id || u?.id || ''), u]));
  const assignees = [];
  let assigned = 0;
  services.forEach((svc, idx) => {
    const match = svc.__allocKey ? { key: svc.__allocKey, rawEntry: allocs[svc.__allocKey], matchKind: 'synthetic' } : findAllocationEntry({ svc, idx, servicesAllocs: allocs });
    const uid = allocationEntryUserId(match.rawEntry);
    if (uid) {
      assigned += 1;
      const u = userById.get(uid);
      const dbName = allocationEntryAssignedName(match.rawEntry);
      const name = dbName || (u ? u.name : '') || uid.slice(0, 8);
      const role = u?.role || (typeof match.rawEntry === 'object' ? String(match.rawEntry?.assignedUserRole || match.rawEntry?.role || '') : '');
      if (!assignees.some((a) => a.uid === uid)) assignees.push({ uid, name, role });
    }
  });
  return { services, total: services.length, assigned, unassigned: services.length - assigned, assignees, userById };
}

function filterSegmentsFor(acc) {
  return [
    { key: 'all', label: 'All clients', icon: ListChecks, count: acc.totalClients, ring: 'ring-slate-200', text: 'text-slate-700', soft: 'bg-slate-100', strong: 'bg-slate-900 text-white' },
    { key: 'assigned', label: 'Assigned services', icon: UserCheck, count: acc.assignedClients, ring: 'ring-emerald-200', text: 'text-emerald-800', soft: 'bg-emerald-50', strong: 'bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-emerald-100' },
    { key: 'partial', label: 'Partially assigned', icon: Percent, count: acc.partialClients, ring: 'ring-amber-200', text: 'text-amber-800', soft: 'bg-amber-50', strong: 'bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-amber-100' },
    { key: 'unassigned', label: 'Fully unassigned', icon: CircleAlert, count: acc.unassignedClients, ring: 'ring-rose-200', text: 'text-rose-800', soft: 'bg-rose-50', strong: 'bg-gradient-to-r from-rose-500 to-pink-500 text-white shadow-rose-100' }
  ];
}

async function fetchAllAllocationClients() {
  const params = { paginated: true, allocation: true, page: 1, limit: 100 };
  const first = await api.get(API_ENDPOINTS.clients.list, { params });
  const totalPages = Number(first.data?.pagination?.totalPages || 1);
  const remaining = totalPages > 1
    ? await Promise.all(Array.from({ length: totalPages - 1 }, (_, index) => (
      api.get(API_ENDPOINTS.clients.list, { params: { ...params, page: index + 2 } })
    )))
    : [];
  return [first, ...remaining].flatMap((response) => response.data?.clients || []);
}

export default function ClientMasterAllocate() {
  const navigate = useNavigate();
  const [currentUser, setCurrentUser] = useState(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [clients, setClients] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState(null);
  const [modalClient, setModalClient] = useState(null);
  const [allocationsByKey, setAllocationsByKey] = useState({});
  const [segment, setSegment] = useState('all');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const handleLogout = async () => {
    try { await api.post(API_ENDPOINTS.auth.logout || '/auth/logout', {}).catch(() => {}); } catch {}
    localStorage.removeItem('token'); localStorage.removeItem('user'); window.location.href = '/login';
  };

  useEffect(() => {
    try { const raw = localStorage.getItem('user'); if (raw) setCurrentUser(JSON.parse(raw)); } catch {}
    loadEverything();
    async function loadEverything() {
      try {
        setLoading(true);
        const [cl] = await Promise.all([
          fetchAllAllocationClients().catch((e) => { console.warn('[CMAllocate] clients fetch fail', e); return []; }),
          fetchUsers()
        ]);
        setClients(cl);
      } catch (e) { console.error('[CMAllocate] load fail', e); } finally { setLoading(false); }
    }
  }, []);

  // Reset pagination to page 1 whenever search / segment / total results change
  useEffect(() => { setPage(1); }, [search, segment, selectedUserId, clients.length]);

  async function fetchUsers() {
    const endpoints = [API_ENDPOINTS.auth.users, API_ENDPOINTS.auth.adminUsers].filter(Boolean);
    let lastErr = null;
    for (const ep of endpoints) {
      try {
        const res = await api.get(ep);
        const ul = Array.isArray(res?.data?.users)
          ? res.data.users
          : (Array.isArray(res?.data) ? res.data : null);
        if (ul) {
          const cleaned = Array.isArray(ul) ? ul.filter((u) => u && (u._id || u.id)) : [];
          console.debug('[CMAllocate] users loaded', { endpoint: ep, count: cleaned.length });
          setUsers(cleaned.filter((u) => u.isActive !== false));
          return { data: { users: cleaned } };
        }
      } catch (e) { lastErr = e; console.warn('[CMAllocate] users fetch fail endpoint:', ep, e); }
    }
    console.warn('[CMAllocate] users endpoints all failed', lastErr);
    setUsers([]);
    return { data: { users: [] } };
  }

  const roleOk = (user) => {
    const r = String(user?.role || '').toLowerCase();
    return adminRoles.includes(r) || r === 'manager';
  };

  const uniqueClients = useMemo(() => deduplicateClientMastersForAllocation(clients), [clients]);
  const enrichedRows = useMemo(() => uniqueClients.map((c) => ({ client: c, alloc: allocationsForClient(c), overview: readClientOverview(c) })), [uniqueClients]);
  const userFilterOptions = useMemo(() => {
    const options = new Map(users.map((u) => [String(u._id || u.id), userDisplay(u)]));
    clients.forEach((client) => {
      allocationOverviewWithAssignees(client, users).assignees.forEach(({ uid, name }) => {
        if (!options.has(uid)) options.set(uid, name || uid);
      });
    });
    return Array.from(options, ([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [clients, users]);
  const userMatched = useMemo(() => {
    if (!selectedUserId) return enrichedRows;
    const matchingGroups = new Set(clients
      .filter((client) => allocationOverviewWithAssignees(client, users).assignees.some(({ uid }) => uid === selectedUserId))
      .map(clientAllocationGroupIdentity));
    return enrichedRows.filter(({ client }) => matchingGroups.has(clientAllocationGroupIdentity(client)));
  }, [enrichedRows, clients, users, selectedUserId]);
  const searchMatched = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return userMatched;
    return userMatched.filter((row) => {
      const o = row.overview;
      return [o.companyName, o.contactPerson, o.mobile, o.email, o.gstin, o.state, o.city, o.leadCode].some((v) => String(v || '').toLowerCase().includes(q));
    });
  }, [userMatched, search]);
  const segmented = useMemo(() => {
    if (segment === 'all') return searchMatched;
    if (segment === 'assigned') return searchMatched.filter((r) => r.alloc.assigned > 0 && r.alloc.assigned === r.alloc.total);
    if (segment === 'partial') return searchMatched.filter((r) => r.alloc.assigned > 0 && r.alloc.assigned < r.alloc.total);
    if (segment === 'unassigned') return searchMatched.filter((r) => r.alloc.assigned === 0 && r.alloc.total > 0);
    return searchMatched;
  }, [searchMatched, segment]);

  const aggregates = useMemo(() => {
    let totalClients = enrichedRows.length;
    let totalServices = 0;
    let assignedServices = 0;
    let assignedClients = 0;
    let partialClients = 0;
    let unassignedClients = 0;
    enrichedRows.forEach((r) => {
      totalServices += r.alloc.total;
      assignedServices += r.alloc.assigned;
      if (r.alloc.total === 0) return;
      if (r.alloc.assigned === 0) unassignedClients += 1;
      else if (r.alloc.assigned === r.alloc.total) assignedClients += 1;
      else partialClients += 1;
    });
    const progress = totalServices ? Math.round((assignedServices / totalServices) * 100) : 0;
    return { totalClients, totalServices, assignedServices, unassignedServices: totalServices - assignedServices, assignedClients, partialClients, unassignedClients, progress, staff: users.length };
  }, [enrichedRows, users]);

  const visibleRows = segmented;
  const pagination = useMemo(() => {
    const total = visibleRows.length;
    const safeSize = Number.isFinite(pageSize) && pageSize > 0 ? pageSize : 25;
    const totalPages = Math.max(1, Math.ceil(total / safeSize));
    let currentPage = Number.isFinite(page) && page >= 1 ? page : 1;
    if (currentPage > totalPages) currentPage = totalPages;
    const startIdx = total === 0 ? 0 : (currentPage - 1) * safeSize;
    const endIdx = total === 0 ? 0 : Math.min(total, startIdx + safeSize);
    const pagesWindow = (() => {
      const win = [];
      const delta = 1;
      const left = Math.max(2, currentPage - delta);
      const right = Math.min(totalPages - 1, currentPage + delta);
      win.push(1);
      if (left > 2) win.push('…left');
      for (let p = left; p <= right; p += 1) win.push(p);
      if (right < totalPages - 1) win.push('…right');
      if (totalPages > 1) win.push(totalPages);
      return win;
    })();
    return { total, pageSize: safeSize, totalPages, page: currentPage, startIdx, endIdx, pagesWindow, pageRangeStart: total === 0 ? 0 : startIdx + 1, pageRangeEnd: endIdx };
  }, [visibleRows, page, pageSize]);
  const pagedRows = useMemo(() => (pagination.total === 0 ? [] : visibleRows.slice(pagination.startIdx, pagination.endIdx)), [visibleRows, pagination]);
  const userList = useMemo(() => users.slice().sort((a, b) => (a.name || `${a.firstName || ''} ${a.lastName || ''}`).localeCompare(b.name || `${b.firstName || ''} ${b.lastName || ''}`)), [users]);

  const openAllocation = (client) => {
    const groupIdentity = clientAllocationGroupIdentity(client);
    const groupedClients = clients.filter((candidate) => clientAllocationGroupIdentity(candidate) === groupIdentity);
    const services = groupedClients.flatMap((sourceClient) => extractServicesFromClient(sourceClient).map((svc, serviceIndex) => ({
      ...svc,
      __allocationClientId: String(sourceClient._id || ''),
      __allocationClient: sourceClient,
      __allocationServiceIndex: serviceIndex
    })));
    const next = {};
    services.forEach((svc, idx) => {
      const sourceClient = svc.__allocationClient;
      const existingAllocs = (sourceClient?.serviceAllocations && typeof sourceClient.serviceAllocations === 'object')
        ? { ...(sourceClient.serviceAllocations.toObject ? sourceClient.serviceAllocations.toObject() : sourceClient.serviceAllocations) }
        : {};
      const serviceIndex = svc.__allocationServiceIndex ?? idx;
      const key = allocationKeyForService(svc, serviceIndex);
      const match = findAllocationEntry({ svc, idx: serviceIndex, servicesAllocs: existingAllocs });
      const uid = allocationEntryUserId(match.rawEntry);
      next[allocationStateKey(svc.__allocationClientId, key)] = uid;
    });
    setAllocationsByKey(next);
    setModalClient({ client, clients: groupedClients, services });
  };

  const saveAllocations = async () => {
    if (!modalClient?.client?._id) return;
    try {
      setSaving(true);
      if (Array.isArray(modalClient.clients) && Array.isArray(modalClient.services)) {
        const allocationsByClient = new Map();
        modalClient.services.forEach((svc, idx) => {
          const clientId = String(svc.__allocationClientId || '').trim();
          if (!clientId) return;
          const serviceKey = allocationKeyForService(svc, svc.__allocationServiceIndex ?? idx);
          const userId = String(allocationsByKey[allocationStateKey(clientId, serviceKey)] || '').trim();
          if (!userId) return;
          if (!allocationsByClient.has(clientId)) allocationsByClient.set(clientId, {});
          allocationsByClient.get(clientId)[serviceKey] = userId;
        });
        const requests = [...allocationsByClient.entries()].map(async ([clientId, allocations]) => {
          console.debug('[CMAllocate] saving grouped allocations body=', allocations, 'for client=', clientId);
          const response = await api.put(API_ENDPOINTS.clients.allocations(clientId), { allocations });
          if (!response.data?.ok) throw new Error(response.data?.error || response.data?.message || `Save failed for client ${clientId}`);
          const stored = response.data._rawStored && typeof response.data._rawStored === 'object'
            ? response.data._rawStored
            : response.data.allocations;
          if (Object.keys(allocations).length > 0 && (!stored || Object.keys(stored).length === 0)) {
            throw new Error(`Database verification failed for client ${clientId}`);
          }
          return response.data;
        });
        if (requests.length === 0) {
          showToast('error', 'Nothing to save', 'Select at least one user before saving allocations.');
          return;
        }
        const results = await Promise.all(requests);
        const savedSlots = results.reduce((total, result) => total + Object.keys(result.allocations || {}).length, 0);
        const refreshedClients = await fetchAllAllocationClients();
        setClients(refreshedClients);
        showToast('success', 'Allocations saved', `${savedSlots} service allocation(s) saved across ${results.length} Client Master record(s).`);
        setModalClient(null);
        return;
      }
      const body = Object.fromEntries(Object.entries(allocationsByKey).filter(([, v]) => v && String(v).trim()));
      console.debug('[CMAllocate] saving allocations body=', body, 'for client=', modalClient.client._id);
      const res = await api.put(API_ENDPOINTS.clients.allocations(modalClient.client._id), { allocations: body });
      if (res.data?.ok) {
        const serverAllocs = (res.data.allocations && typeof res.data.allocations === 'object') ? res.data.allocations : {};
        const rawStored = (res.data._rawStored && typeof res.data._rawStored === 'object') ? res.data._rawStored : null;
        const dbStoredAllocs = rawStored || serverAllocs;
        const serverCount = Object.keys(serverAllocs).length;
        const dbSlots = Object.keys(dbStoredAllocs).length;
        const sentCount = Object.keys(body).length;
        const debug = res.data._debug || {};
        const normalizedServer = {};
        Object.entries(dbStoredAllocs).forEach(([k, rawEntry]) => {
          const uid = allocationEntryUserId(rawEntry);
          const entryName = allocationEntryAssignedName(rawEntry) || '';
          normalizedServer[k] = {
            ...(typeof rawEntry === 'object' && rawEntry ? rawEntry : { value: rawEntry }),
            userId: uid || (typeof rawEntry === 'object' ? String(rawEntry?.userId || '') : String(rawEntry || ''))
          };
          if (entryName) normalizedServer[k].assignedByName = entryName;
        });
        const idx = clients.findIndex((c) => String(c._id) === String(modalClient.client._id));
        if (idx >= 0) {
          const patched = [...clients];
          patched[idx] = { ...patched[idx], serviceAllocations: Object.assign({}, patched[idx].serviceAllocations || {}, normalizedServer) };
          setClients(patched);
        }
        const extra = [];
        if (typeof debug.rawEntriesCount !== 'undefined') extra.push(`payload=${String(debug.rawEntriesCount)}`);
        if (typeof debug.normalizedCount !== 'undefined') extra.push(`norm=${String(debug.normalizedCount)}`);
        if (typeof debug.atomicWroteKeys !== 'undefined') extra.push(`written=${String(debug.atomicWroteKeys)}`);
        if (typeof debug.storedReloadedKeys !== 'undefined') extra.push(`DBslots=${String(debug.storedReloadedKeys)}`);
        if (typeof debug.finalResponseAllocCount !== 'undefined') extra.push(`returned=${String(debug.finalResponseAllocCount)}`);
        const debugText = extra.length ? `  [debug: ${extra.join(' → ')}]` : '';
        // If 0 allocations saved despite sending assignments
        if (dbSlots === 0 && sentCount > 0) {
          showToast('error', 'Save warning: 0 stored', `You sent ${String(sentCount)} but DB shows 0 allocation slots saved.${debugText}`);
        } else {
          showToast('success', 'Allocations saved', `${res.data.message || `Saved ${String(serverCount)} allocation(s)`}${debugText}`);
        }
        setTimeout(() => refresh().catch(() => {}), 350);
        setModalClient(null);
      } else {
        showToast('error', 'Save failed', res.data?.error || res.data?.message || 'Unknown error');
      }
    } catch (e) { showToast('error', 'Save failed', e?.response?.data?.error || e?.message || 'Unknown error'); } finally { setSaving(false); }
  };

  const refresh = async () => {
    try {
      setRefreshing(true);
      const [cl] = await Promise.all([
        fetchAllAllocationClients(),
        fetchUsers()
      ]);
      setClients(cl);
      showToast('success', 'Refreshed', `${cl.length} clients · ${String(userList.length || 0)} users loaded`);
    } catch (e) { showToast('error', 'Refresh failed', e?.message || ''); } finally { setRefreshing(false); }
  };

  function showToast(kind, title, message) {
    const id = Date.now();
    setToast({ kind, title, message, id });
    setTimeout(() => { setToast((t) => (t?.id === id ? null : t)); }, 4200);
  }

  if (currentUser && !roleOk(currentUser)) {
    return (
      <DashboardShell currentUser={currentUser} onOpenProfile={() => setProfileOpen(true)} onLogout={handleLogout}>
        <div className="px-4 py-6 sm:px-6 lg:px-8">
          <div className="relative overflow-hidden rounded-3xl border border-rose-200 bg-gradient-to-br from-rose-50 to-orange-50 p-7 text-rose-700 shadow-lg shadow-rose-100/80">
            <div className="pointer-events-none absolute -right-14 -top-16 h-44 w-44 rounded-full bg-rose-200/50 blur-3xl" />
            <div className="relative flex items-start gap-4">
              <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white text-rose-600 ring-1 ring-rose-200 shadow-sm"><CircleAlert className="h-7 w-7" /></div>
              <div>
                <div className="text-xs font-black uppercase tracking-[0.22em] text-rose-700/90">403 · Restricted area</div>
                <h2 className="mt-2 text-2xl font-black tracking-tight text-rose-900">Access denied</h2>
                <p className="mt-1 text-sm font-semibold text-rose-700/90">This page is only visible to Managers and Administrators.</p>
                <button type="button" onClick={() => navigate(-1)} className="mt-5 inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-white px-4 py-2.5 text-xs font-black text-rose-700 shadow-sm hover:-translate-y-0.5 hover:shadow-md transition"><ArrowLeft className="h-4 w-4" /> Go back</button>
              </div>
            </div>
          </div>
        </div>
        {profileOpen && <ProfileModal user={currentUser} saving={false} onClose={() => setProfileOpen(false)} onLogout={handleLogout} onSave={() => {}} onUpdatePassword={() => {}} />}
      </DashboardShell>
    );
  }

  const segments = filterSegmentsFor(aggregates);

  return (
    <DashboardShell currentUser={currentUser} onOpenProfile={() => setProfileOpen(true)} onLogout={handleLogout}>
      <div className="relative bg-[linear-gradient(180deg,#eef7ff_0%,#f5f7fb_52%,#f8fafc_100%)] px-4 pb-16 pt-6 sm:px-6 lg:px-8">
        <div className="pointer-events-none absolute left-1/2 top-0 -z-10 h-[380px] w-[980px] max-w-[95vw] -translate-x-1/2 overflow-hidden">
          <div className="absolute -top-32 left-10 h-72 w-72 rounded-full bg-emerald-300/40 blur-3xl" />
          <div className="absolute -top-10 right-4 h-80 w-80 rounded-full bg-sky-300/40 blur-3xl" />
          <div className="absolute bottom-0 left-1/2 h-60 w-60 -translate-x-1/2 rounded-full bg-amber-200/40 blur-3xl" />
        </div>

        <section className="relative mb-6 overflow-hidden rounded-[28px] border border-white/80 bg-white/80 p-6 shadow-[0_20px_70px_rgba(15,23,42,0.08)] backdrop-blur sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="flex flex-wrap items-center gap-4">
              <div className="relative grid h-16 w-16 shrink-0 place-items-center rounded-3xl bg-gradient-to-br from-emerald-500 via-teal-500 to-cyan-500 text-white shadow-[0_18px_40px_rgba(16,185,129,0.35)] ring-1 ring-white/70">
                <div className="absolute inset-0 rounded-3xl bg-gradient-to-tr from-white/20 via-white/0 to-transparent" />
                <Users className="relative h-8 w-8" strokeWidth={2.2} />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-emerald-800 ring-1 ring-emerald-200"><Sparkles className="h-3.5 w-3.5" /> Customer Hub</span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-slate-600 ring-1 ring-slate-200"><ShieldCheck className="h-3.5 w-3.5" /> Admin / Managers only</span>
                </div>
                <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">Client Master <span className="bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 bg-clip-text text-transparent">Allocate</span></h1>
                <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-slate-500">Assign each service (Producer · Brand Owner · Importer · Recycler etc.) to a different CRM user independently. Tap <b className="text-slate-700">Allocate</b> on any client to open the per-service assignment panel.</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => navigate(-1)} className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-black text-slate-700 shadow-sm hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md transition"><ArrowLeft className="h-4 w-4" /> Back</button>
              <button type="button" onClick={refresh} disabled={refreshing} className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-black text-slate-700 shadow-sm hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md transition disabled:opacity-60 disabled:hover:translate-y-0"><RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /> Refresh data</button>
              <div className="inline-flex items-center gap-2 rounded-2xl border border-emerald-200 bg-gradient-to-r from-emerald-50 to-teal-50 px-4 py-2.5 text-[11px] font-black uppercase tracking-wide text-emerald-800 shadow-[0_1px_0_rgba(16,185,129,0.12)] ring-1 ring-emerald-100"><Users className="h-4 w-4" /> {String(userList.length || 0)} staff users</div>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
            <KpiCard icon={Building2} gradient="from-emerald-500 to-teal-500" label="Clients" value={String(aggregates.totalClients)} hint="Total master records" shadowColor="shadow-emerald-100" />
            <KpiCard icon={BriefcaseBusiness} gradient="from-sky-500 to-indigo-500" label="Services" value={String(aggregates.totalServices)} hint="Total assignable services" shadowColor="shadow-sky-100" />
            <KpiCard icon={UserCheck} gradient="from-teal-500 to-cyan-500" label="Assigned" value={String(aggregates.assignedServices)} hint="Services already allocated" shadowColor="shadow-teal-100" />
            <KpiCard icon={UserPlus} gradient="from-rose-500 to-pink-500" label="Unassigned" value={String(aggregates.unassignedServices)} hint="Needs allocation" shadowColor="shadow-rose-100" />
            <KpiCard icon={Percent} gradient="from-amber-500 to-orange-500" label="Progress" value={`${String(aggregates.progress)}%`} hint="Allocated vs total services" progress={aggregates.progress} shadowColor="shadow-amber-100" />
            <KpiCard icon={Gauge} gradient="from-violet-500 to-fuchsia-500" label="Coverage" value={`${String(aggregates.totalClients ? Math.round(((aggregates.assignedClients + aggregates.partialClients) / aggregates.totalClients) * 100) : 0)}%`} hint="Clients at least 1 allocation" progress={aggregates.totalClients ? Math.round(((aggregates.assignedClients + aggregates.partialClients) / aggregates.totalClients) * 100) : 0} shadowColor="shadow-violet-100" />
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <div className="inline-flex items-center gap-2 rounded-2xl bg-slate-50 p-1.5 text-xs font-black text-slate-600 ring-1 ring-slate-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
              <span className="pl-2 pr-1 text-slate-400"><Filter className="h-3.5 w-3.5" /></span>
              {segments.map((s) => {
                const active = segment === s.key;
                return (
                  <button key={s.key} type="button" onClick={() => setSegment(s.key)} className={`group relative inline-flex items-center gap-2 rounded-xl px-3.5 py-2 transition ${active ? s.strong + ' shadow-[0_8px_24px_-8px_rgba(15,23,42,0.25)]' : 'hover:bg-white hover:text-slate-900'}`}>
                    <s.icon className="h-4 w-4" />
                    <span>{s.label}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] ${active ? 'bg-white/25 text-white' : `${s.soft} ${s.text} ${s.ring}`}`}>{String(s.count)}</span>
                  </button>
                );
              })}
            </div>
            <div className="relative w-full sm:w-72">
              <UserCheck className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <select aria-label="Filter by allocated user" value={selectedUserId} onChange={(e) => setSelectedUserId(e.target.value)} className="w-full appearance-none rounded-2xl border border-slate-200 bg-white py-2.5 pl-10 pr-9 text-sm font-semibold text-slate-800 shadow-sm focus:border-emerald-300 focus:outline-none focus:ring-4 focus:ring-emerald-100">
                <option value="">All users</option>
                {userFilterOptions.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            </div>
            {selectedUserId && <button type="button" onClick={() => setSelectedUserId('')} className="inline-flex items-center gap-1 rounded-xl px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100"><X className="h-3.5 w-3.5" /> Clear user filter</button>}
            <div className="ml-auto relative w-full sm:w-96">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} type="search" placeholder="Search company, contact, GST, mobile, lead code, location..." className="w-full rounded-2xl border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm font-semibold text-slate-800 placeholder:text-slate-400 shadow-sm focus:border-emerald-300 focus:outline-none focus:ring-4 focus:ring-emerald-100" />
            </div>
          </div>
        </section>

        <section className="relative overflow-hidden rounded-[28px] border border-white/80 bg-white/90 shadow-[0_20px_70px_rgba(15,23,42,0.08)] backdrop-blur">
          <div className="flex flex-col gap-3 border-b border-orange-100 bg-gradient-to-r from-orange-50 via-amber-50 to-yellow-50 px-5 py-4 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <div className="text-xs font-black text-orange-900">
                Showing <b className="rounded-lg bg-gradient-to-r from-orange-500 to-amber-500 px-2 py-0.5 text-white shadow-[0_6px_18px_-6px_rgba(249,115,22,0.55)]">{pagination.total === 0 ? '0' : `${String(pagination.pageRangeStart)}-${String(pagination.pageRangeEnd)}`}</b> of <b className="text-orange-950">{String(pagination.total)}</b> client{String(pagination.total) === '1' ? '' : 's'} · <b className="text-amber-900">{String(uniqueClients.length)}</b> total masters · <b className="text-orange-700">{String(aggregates.progress)}%</b> service allocation progress
              </div>
              <div className="inline-flex items-center gap-1.5 rounded-2xl bg-white px-2.5 py-1.5 text-[11px] font-black text-orange-800 ring-1 ring-orange-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
                <span className="pl-1 pr-0.5 text-orange-500">Rows per page</span>
                <select
                  value={String(pagination.pageSize)}
                  onChange={(e) => { setPageSize(Math.max(1, Number(e.target.value) || 25)); setPage(1); }}
                  className="cursor-pointer rounded-xl bg-orange-50 px-2.5 py-1 text-[11px] font-black text-orange-900 outline-none ring-1 ring-orange-200 transition focus:ring-2 focus:ring-orange-400"
                >
                  {[10, 25, 50, 100, 250].map((size) => <option key={size} value={size}>{String(size)} rows</option>)}
                </select>
              </div>
              <div className="inline-flex items-center gap-2 rounded-2xl bg-white px-3 py-2 text-[11px] font-black text-orange-800 ring-1 ring-orange-200">
                <CheckCircle2 className="h-3.5 w-3.5 text-orange-600" /> Role visibility restricted to <span className="text-orange-900">Admin · SuperAdmin · Manager</span>
              </div>
            </div>
            {pagination.totalPages > 1 && (
              <div className="inline-flex flex-wrap items-center gap-1.5">
                <button type="button" disabled={pagination.page <= 1} onClick={() => setPage(1)} className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-orange-200 bg-white text-orange-700 shadow-sm transition hover:border-orange-400 hover:bg-orange-100 hover:text-orange-900 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white disabled:hover:text-orange-700 disabled:hover:border-orange-200" title="First page"><ChevronsLeft className="h-4 w-4" /></button>
                <button type="button" disabled={pagination.page <= 1} onClick={() => setPage((p) => Math.max(1, (Number.isFinite(p) && p > 0 ? p : 1) - 1))} className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-orange-200 bg-white text-orange-700 shadow-sm transition hover:border-orange-400 hover:bg-orange-100 hover:text-orange-900 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white disabled:hover:text-orange-700 disabled:hover:border-orange-200" title="Previous page"><ChevronLeft className="h-4 w-4" /></button>
                <div className="mx-0.5 inline-flex items-center gap-1.5">
                  {pagination.pagesWindow.map((p, i) => {
                    if (typeof p === 'string') {
                      return <span key={`pg-${p}-${i}`} className="inline-flex h-9 items-center px-1 text-[11px] font-bold text-orange-500">···</span>;
                    }
                    const active = p === pagination.page;
                    return (
                      <button
                        key={`pg-${p}`}
                        type="button"
                        onClick={() => setPage(p)}
                        className={`inline-flex h-9 min-w-9 items-center justify-center rounded-xl px-3 text-[12px] font-black transition ${active ? 'bg-gradient-to-br from-orange-500 via-amber-500 to-yellow-500 text-white shadow-[0_10px_26px_-10px_rgba(249,115,22,0.85)] ring-1 ring-white/50' : 'border border-orange-200 bg-white text-orange-800 shadow-sm hover:border-orange-400 hover:bg-orange-100 hover:text-orange-950'}`}
                        title={`Page ${String(p)} of ${String(pagination.totalPages)}`}
                      >{String(p)}</button>
                    );
                  })}
                </div>
                <button type="button" disabled={pagination.page >= pagination.totalPages} onClick={() => setPage((p) => Math.min(pagination.totalPages, (Number.isFinite(p) && p > 0 ? p : 1) + 1))} className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-orange-200 bg-white text-orange-700 shadow-sm transition hover:border-orange-400 hover:bg-orange-100 hover:text-orange-900 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white disabled:hover:text-orange-700 disabled:hover:border-orange-200" title="Next page"><ChevronRight className="h-4 w-4" /></button>
                <button type="button" disabled={pagination.page >= pagination.totalPages} onClick={() => setPage(pagination.totalPages)} className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-orange-200 bg-white text-orange-700 shadow-sm transition hover:border-orange-400 hover:bg-orange-100 hover:text-orange-900 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white disabled:hover:text-orange-700 disabled:hover:border-orange-200" title="Last page"><ChevronsRight className="h-4 w-4" /></button>
                <div className="ml-1 inline-flex items-center gap-1 rounded-xl bg-gradient-to-r from-orange-500 via-amber-500 to-yellow-500 px-2.5 py-1.5 text-[10px] font-black uppercase tracking-widest text-white shadow-[0_8px_20px_-6px_rgba(249,115,22,0.7)]">
                  Page {String(pagination.page)} · {String(pagination.totalPages)}
                </div>
              </div>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead>
                <tr className="bg-gradient-to-r from-orange-200/80 via-amber-200/80 to-yellow-200/80 text-[10px] font-black uppercase tracking-[0.18em] text-orange-950 ring-1 ring-inset ring-orange-300/50">
                  <th className="w-[72px] px-5 py-4 text-center">Sr.No</th>
                  <th className="px-5 py-4 text-left"><span className="inline-flex items-center gap-2"><Building2 className="h-3.5 w-3.5 text-orange-700" /> Company / Lead</span></th>
                  <th className="px-5 py-4 text-left"><span className="inline-flex items-center gap-2"><Phone className="h-3.5 w-3.5 text-amber-700" /> Contact</span></th>
                  <th className="px-5 py-4 text-left"><span className="inline-flex items-center gap-2"><MapPin className="h-3.5 w-3.5 text-yellow-700" /> GST / Location</span></th>
                  <th className="px-5 py-4 text-left"><span className="inline-flex items-center gap-2"><BriefcaseBusiness className="h-3.5 w-3.5 text-orange-800" /> Services</span></th>
                  <th className="px-5 py-4 text-left w-[230px]"><span className="inline-flex items-center gap-2"><ListChecks className="h-3.5 w-3.5 text-amber-800" /> Allocations</span></th>
                  <th className="px-5 py-4 text-right w-[200px]"><span className="inline-flex items-center justify-end gap-2 text-orange-900">Action</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {loading && <tr><td colSpan="7" className="px-5 py-16 text-center">
                  <div className="inline-flex items-center gap-3 rounded-2xl bg-emerald-50 px-5 py-3 text-sm font-bold text-emerald-700 ring-1 ring-emerald-100"><RefreshCw className="h-4 w-4 animate-spin" /> Loading client master allocations…</div>
                </td></tr>}
                {!loading && visibleRows.length === 0 && <tr><td colSpan="7" className="px-5 py-16">
                  <div className="mx-auto flex max-w-lg flex-col items-center gap-3 text-center">
                    <div className="grid h-16 w-16 place-items-center rounded-3xl bg-slate-50 text-slate-400 ring-1 ring-slate-200"><Search className="h-7 w-7" /></div>
                    <h3 className="text-xl font-black text-slate-900">No clients{search || selectedUserId || segment !== 'all' ? ' matching filters' : ''}</h3>
                    <p className="text-sm font-semibold text-slate-500">Try clearing the user filter or search, switching the segment tab above or press Refresh.</p>
                  </div>
                </td></tr>}
                {!loading && pagedRows.map((row, rowIdx) => {
                  const { client, overview, alloc } = row;
                  const absoluteIdx = pagination.startIdx + rowIdx;
                  const progress = alloc.total ? Math.round((alloc.assigned / alloc.total) * 100) : 0;
                  return (
                    <tr key={String(client._id)} className="group transition hover:bg-[linear-gradient(90deg,rgba(16,185,129,0.04)_0%,rgba(14,165,233,0.03)_100%)] even:bg-slate-50/40">
                      <td className="px-5 py-4 text-center text-xs font-black text-slate-500">{absoluteIdx + 1}</td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-emerald-100 to-teal-100 text-emerald-700 ring-1 ring-emerald-200/70 group-hover:from-emerald-200 group-hover:to-teal-200 transition`}>
                            <Building2 className="h-5 w-5" strokeWidth={2.1} />
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-[14.5px] font-black tracking-tight text-slate-950" title={overview.companyName}>{overview.companyName}</div>
                            <div className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-emerald-700 ring-1 ring-emerald-100">{overview.leadCode || String(client.uniqueId || '').trim() || '—'}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-start gap-2">
                          <Phone className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                          <div className="min-w-0">
                            <div className="truncate text-sm font-bold text-slate-800">{overview.contactPerson || <span className="text-slate-400">—</span>}</div>
                            <div className="mt-0.5 truncate text-xs font-semibold text-slate-500" title={[overview.mobile, overview.email].filter(Boolean).join(' · ')}>{[overview.mobile, overview.email].filter(Boolean).join(' · ') || <span className="text-slate-400">No contact details</span>}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-start gap-2">
                          <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                          <div className="min-w-0">
                            <div className="truncate text-sm font-bold text-slate-800">{overview.gstin || <span className="text-slate-400">—</span>}</div>
                            <div className="mt-0.5 truncate text-xs font-semibold text-slate-500">{[overview.city, overview.state].filter(Boolean).join(', ') || <span className="text-slate-400">Location not set</span>}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex max-w-[440px] flex-wrap gap-1.5">
                          {alloc.services.length === 0 ? (
                            <span className="inline-flex items-center gap-1 rounded-xl bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-500 ring-1 ring-slate-200"><CircleAlert className="h-3.5 w-3.5" /> No services</span>
                          ) : alloc.services.map((svc, i) => {
                            const theme = getApplicantTheme(svc.piboCategory || svc.subApplicantType || svc.applicantType || '');
                            const ApplicantIcon = theme.accentIcon;
                            return (
                              <div key={`svc-${String(client._id)}-${i}`} className={`group/svc inline-flex max-w-full items-center gap-1.5 rounded-2xl px-2.5 py-1 text-[11px] font-black ring-1 shadow-[0_1px_0_rgba(15,23,42,0.04)] transition hover:-translate-y-0.5 hover:shadow-md ${theme.badgeBg} ${theme.badgeText} ${theme.badgeRing}`} title={`${svc.piboCategory || svc.subApplicantType || svc.applicantType || 'Service'}${svc.eprCategory || svc.serviceCategory ? ' · ' + (svc.eprCategory || svc.serviceCategory) : ''}`}>
                                <span className={`inline-flex h-[18px] w-[18px] items-center justify-center rounded-lg bg-white ring-1 ${theme.ring}`}><ApplicantIcon className="h-3.5 w-3.5" /></span>
                                <span className="truncate">{svc.piboCategory || svc.subApplicantType || svc.applicantType || 'Service'}</span>
                                {(svc.eprCategory || svc.serviceCategory) && <span className="truncate text-slate-400 group-hover/svc:text-slate-600 transition">· {svc.eprCategory || svc.serviceCategory}</span>}
                                {svc.servicesOffered && <span className="truncate rounded-full bg-white/70 px-1.5 py-0.5 text-[10px] text-slate-600 ring-1 ring-white">{svc.servicesOffered}</span>}
                              </div>
                            );
                          })}
                        </div>
                        <div className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-widest text-slate-500 ring-1 ring-slate-200"><BriefcaseBusiness className="h-3 w-3" /> {alloc.total} total</div>
                      </td>
                      <td className="px-5 py-4 align-middle">
                        {(() => {
                          const overview = allocationOverviewWithAssignees(client, userList);
                          const debugSlots = overview._debugAllocs || (() => {
                            const store = (client.serviceAllocations && typeof client.serviceAllocations === 'object')
                              ? (client.serviceAllocations.toObject ? client.serviceAllocations.toObject() : client.serviceAllocations)
                              : {};
                            return Object.keys(store).length;
                          })();
                          if (overview.total === 0) return <span className="inline-flex items-center gap-1 rounded-xl bg-slate-50 px-2.5 py-1 text-[11px] font-black text-slate-500 ring-1 ring-slate-200"><CircleAlert className="h-3.5 w-3.5" /> No services</span>;
                          const pills = [];
                          if (overview.assigned === overview.total && overview.total > 0) {
                            pills.push(<div key="fully" className="inline-flex items-center gap-1 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-2.5 py-1 text-[11px] font-black text-white shadow-emerald-100 ring-1 ring-emerald-400/30"><CheckCircle2 className="h-3.5 w-3.5" /> Fully allocated</div>);
                          } else if (overview.assigned > 0) {
                            pills.push(<div key="partial" className="inline-flex items-center gap-1 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-2.5 py-1 text-[11px] font-black text-white shadow-amber-100 ring-1 ring-amber-400/30"><Percent className="h-3.5 w-3.5" /> Partial {overview.assigned}/{overview.total}</div>);
                          } else {
                            pills.push(<div key="none" className="inline-flex items-center gap-1 rounded-xl bg-gradient-to-r from-rose-500 to-pink-500 px-2.5 py-1 text-[11px] font-black text-white shadow-rose-100 ring-1 ring-rose-400/30"><CircleAlert className="h-3.5 w-3.5" /> Unassigned</div>);
                          }
                          pills.push(
                            <div key="dbcount" className="inline-flex items-center gap-1 rounded-xl bg-white px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-slate-500 ring-1 ring-slate-200 shadow-sm" title={`Total allocation slot entries stored in DB on this Client document (${String(debugSlots)}). If this number is >0 but display still shows Unassigned, it means the stored key shape differs slightly from service list key shape — fuzzy matcher should auto bridge.`}>
                              <Database className="h-3 w-3" /> DB:{String(debugSlots)}
                            </div>
                          );
                          return (
                            <div className="w-[280px]">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex flex-wrap items-center gap-1.5">{pills}</div>
                                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">{progress}%</span>
                              </div>
                              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100 ring-1 ring-inset ring-slate-200">
                                <div
                                  className={`h-full rounded-full transition-all duration-700 ${
                                    overview.assigned === 0 ? 'bg-gradient-to-r from-rose-400 to-pink-400'
                                      : overview.assigned === overview.total ? 'bg-gradient-to-r from-emerald-500 to-teal-500'
                                      : 'bg-gradient-to-r from-amber-400 via-orange-400 to-amber-500'
                                  }`}
                                  style={{ width: `${String(progress)}%` }}
                                />
                              </div>
                              {overview.assigned > 0 && overview.assignees.length > 0 && (
                                <div className="mt-2.5 space-y-1.5">
                                  <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Allocated to</div>
                                  <div className="flex max-w-full flex-wrap items-center gap-1.5">
                                    {overview.assignees.slice(0, 3).map((u) => (
                                      <span key={u.uid} className="inline-flex items-center gap-1 rounded-xl border border-emerald-200 bg-gradient-to-r from-emerald-50 to-teal-50 px-2.5 py-1 text-[11px] font-black text-emerald-900 ring-1 ring-white shadow-sm" title={`Allocated services for this client: ${u.name}${u.role ? ` · ${roleLabels[u.role] || u.role}` : ''}`}>
                                        <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-500 text-white ring-1 ring-white/50"><UserCheck className="h-3 w-3" /></span>
                                        <span className="truncate">{u.name}</span>
                                        {u.role && <span className="truncate rounded-full bg-white px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest text-emerald-800 ring-1 ring-emerald-200">{roleLabels[u.role] || u.role}</span>}
                                      </span>
                                    ))}
                                    {overview.assignees.length > 3 && (
                                      <span className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-black text-slate-600 ring-1 ring-white shadow-sm">+{String(overview.assignees.length - 3)} more</span>
                                    )}
                                  </div>
                                  {overview.assignees.length > 0 && (
                                    <div className="text-[10px] font-semibold leading-4 text-slate-500 truncate">
                                      {overview.assignees.length === 1
                                        ? <>Owner: <b className="text-emerald-800">{overview.assignees[0].name}</b></>
                                        : <>Assigned to <b className="text-emerald-800">{String(overview.assignees.length)} user{overview.assignees.length === 1 ? '' : 's'}</b>: {overview.assignees.slice(0, 2).map((u) => u.name).join(', ')}{overview.assignees.length > 2 ? `, +${String(overview.assignees.length - 2)}` : ''}</>
                                      }
                                    </div>
                                  )}
                                </div>
                              )}
                              {overview.assigned === 0 && (
                                <div className="mt-2 text-[11px] font-bold leading-4 text-rose-700/80">No staff user assigned yet. Click <b className="text-rose-800">Allocate Client</b> on the right.</div>
                              )}
                            </div>
                          );
                        })()}
                      </td>
                      <td className="px-5 py-4 text-right align-middle">
                        <div className="flex flex-wrap justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => openAllocation(client)}
                            className="group/btn relative inline-flex items-center gap-1.5 overflow-hidden rounded-2xl bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 px-4 py-2.5 text-xs font-black text-white shadow-[0_10px_30px_-10px_rgba(16,185,129,0.6)] ring-1 ring-white/30 transition hover:-translate-y-0.5 hover:shadow-[0_18px_45px_-10px_rgba(16,185,129,0.75)]"
                            title="Open per-service user allocation panel"
                          >
                            <span className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-white/20 via-white/0 to-transparent opacity-80" />
                            <Users className="relative h-4 w-4" />
                            <span className="relative">Allocate Client</span>
                            <ChevronDown className="relative h-3.5 w-3.5 opacity-80 group-hover/btn:translate-y-0.5 transition" />
                          </button>
                        </div>
                        {absoluteIdx === 0 && alloc.total >= 2 && (
                          <div className="mt-2 text-[10px] font-bold text-slate-400">Tip: Producer & Importer can go to different users.</div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-orange-100 bg-gradient-to-r from-orange-50/50 via-amber-50/30 to-yellow-50/50 px-5 py-3">
            <div className="text-xs font-black text-orange-800">
              {pagination.total === 0 ? 'No matching clients' : `Showing records ${String(pagination.pageRangeStart)}–${String(pagination.pageRangeEnd)} of ${String(pagination.total)}${pagination.totalPages > 1 ? ` · Page ${String(pagination.page)} / ${String(pagination.totalPages)}` : ''}`}
              {` · ${String(aggregates.assignedClients)} fully assigned clients · ${String(aggregates.partialClients)} partial · ${String(aggregates.unassignedClients)} awaiting allocation`}
            </div>
            <div className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-orange-500 via-amber-500 to-yellow-500 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-white shadow-[0_8px_20px_-6px_rgba(249,115,22,0.65)] ring-1 ring-white/40">
              <ListChecks className="h-3 w-3" /> Overall {String(aggregates.progress)}% allocated
            </div>
          </div>
        </section>

        {modalClient && <AllocationModal isOpen onClose={() => !saving && setModalClient(null)} client={modalClient.client} services={modalClient.services} users={userList} values={allocationsByKey} setValues={setAllocationsByKey} saving={saving} onSave={saveAllocations} />}
        {toast && <ToastNotification toast={toast} onClose={() => setToast(null)} />}
        {profileOpen && <ProfileModal user={currentUser} saving={false} onClose={() => setProfileOpen(false)} onLogout={handleLogout} onSave={() => {}} onUpdatePassword={() => {}} />}
      </div>
    </DashboardShell>
  );
}

function KpiCard({ icon: Icon, gradient, label, value, hint, progress, shadowColor = 'shadow-slate-100' }) {
  return (
    <div className={`relative overflow-hidden rounded-2xl border border-white bg-white p-4 shadow-[0_12px_35px_-10px_rgba(15,23,42,0.15)] ${shadowColor}`}>
      <div className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full bg-gradient-to-br opacity-20 blur-2xl" style={{ backgroundImage: `linear-gradient(135deg, var(--tw-gradient-stops))` }} />
      <div className={`mb-3 inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br text-white ring-1 ring-white/70 shadow-[0_10px_25px_-8px_rgba(15,23,42,0.35)] ${gradient}`}><Icon className="h-5 w-5" strokeWidth={2.2} /></div>
      <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-black tracking-tight text-slate-950">{value}</div>
      {typeof progress === 'number' ? (
        <div className="mt-3">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 ring-1 ring-inset ring-slate-200">
            <div className={`h-full rounded-full bg-gradient-to-r ${gradient}`} style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} />
          </div>
        </div>
      ) : <div className="mt-1 text-[11px] font-semibold text-slate-500">{hint}</div>}
    </div>
  );
}

function AllocationModal({ isOpen, onClose, client, services = [], users = [], values = {}, setValues, saving, onSave }) {
  if (!isOpen || !client) return null;
  const overview = readClientOverview(client);
  const userById = useMemo(() => new Map(users.map((u) => [String(u._id || u.id), u])), [users]);
  const rows = services.map((svc, idx) => {
    const sourceClient = svc.__allocationClient || client;
    const clientId = String(svc.__allocationClientId || sourceClient._id || client._id || '');
    const serviceIndex = svc.__allocationServiceIndex ?? idx;
    const existingAllocs = (sourceClient.serviceAllocations && typeof sourceClient.serviceAllocations === 'object')
      ? (sourceClient.serviceAllocations.toObject ? sourceClient.serviceAllocations.toObject() : sourceClient.serviceAllocations)
      : {};
    const key = allocationKeyForService(svc, serviceIndex);
    const stateKey = allocationStateKey(clientId, key);
    const existingMatch = findAllocationEntry({ svc, idx: serviceIndex, servicesAllocs: existingAllocs });
    const existingUserId = allocationEntryUserId(existingMatch.rawEntry);
    const current = String(values[stateKey] || '').trim();
    const fallbackText = existingUserId && userById.has(existingUserId) ? userDisplay(userById.get(existingUserId)) : null;
    const selectedUser = current && userById.has(current) ? userById.get(current) : (existingUserId && userById.has(existingUserId) ? userById.get(existingUserId) : null);
    return { svc, idx, key, stateKey, clientId, current, existingUserId, selectedUser, fallbackText };
  });
  const assignedCount = rows.filter((r) => r.current || (r.existingUserId && !r.current)).length;
  const progress = rows.length ? Math.round((assignedCount / rows.length) * 100) : 0;
  return (
    <div className="fixed inset-0 z-[100] grid place-items-end overflow-y-auto bg-slate-950/55 px-2 py-4 backdrop-blur-md sm:place-items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="allocate-services-title">
      <div className="relative my-auto w-full max-w-5xl overflow-hidden rounded-[28px] bg-white shadow-[0_40px_110px_rgba(15,23,42,0.35)] ring-1 ring-white">
        <div className="pointer-events-none absolute -left-20 -top-24 h-72 w-72 rounded-full bg-emerald-300/50 blur-3xl" />
        <div className="pointer-events-none absolute -right-24 top-10 h-80 w-80 rounded-full bg-sky-300/50 blur-3xl" />
        <div className="pointer-events-none absolute bottom-0 left-1/3 h-64 w-64 rounded-full bg-amber-200/40 blur-3xl" />

        <header className="relative flex flex-wrap items-start justify-between gap-4 border-b border-emerald-100/70 bg-gradient-to-r from-emerald-50/90 via-white/80 to-sky-50/90 px-6 py-6 sm:px-8 sm:py-7">
          <div className="flex items-start gap-4">
            <div className="relative grid h-16 w-16 shrink-0 place-items-center rounded-3xl bg-gradient-to-br from-emerald-500 via-teal-500 to-cyan-500 text-white shadow-[0_20px_50px_-12px_rgba(16,185,129,0.55)] ring-1 ring-white/70">
              <div className="absolute inset-0 rounded-3xl bg-gradient-to-tr from-white/30 via-white/0 to-transparent" />
              <Users className="relative h-8 w-8" strokeWidth={2.1} />
            </div>
            <div className="min-w-0 max-w-xl">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-600/90 px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-white shadow-emerald-200"><Sparkles className="h-3.5 w-3.5" /> Allocate services</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-[10px] font-black uppercase tracking-widest text-slate-600 ring-1 ring-slate-200"><BriefcaseBusiness className="h-3.5 w-3.5" /> {rows.length} services</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-amber-800 ring-1 ring-amber-200"><Percent className="h-3.5 w-3.5" /> {progress}% done</span>
              </div>
              <h2 id="allocate-services-title" className="mt-2 truncate text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">{overview.companyName}</h2>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs font-bold text-slate-500">
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-black text-emerald-800 ring-1 ring-emerald-200">{overview.leadCode || String(client.uniqueId || '').trim() || '—'}</span>
                {overview.contactPerson && <span className="inline-flex items-center gap-1"><Phone className="h-3.5 w-3.5 text-slate-400" /> {overview.contactPerson}</span>}
                {overview.mobile && <span className="inline-flex items-center gap-1">{overview.mobile}</span>}
                {overview.gstin && <span className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-slate-700 ring-1 ring-slate-200">GST {overview.gstin}</span>}
                {(overview.city || overview.state) && <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5 text-slate-400" /> {[overview.city, overview.state].filter(Boolean).join(', ')}</span>}
              </div>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={saving} className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md disabled:opacity-50 disabled:hover:translate-y-0"><X className="h-5 w-5" /></button>
        </header>

        <div className="grid gap-6 p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="min-w-0">
            <div className="mb-5 flex flex-wrap items-center gap-3 rounded-3xl border border-slate-200 bg-gradient-to-r from-slate-50 to-white p-4">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-white text-slate-700 shadow-sm ring-1 ring-slate-200"><CheckCircle2 className="h-5 w-5" /></div>
              <div className="min-w-0">
                <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Service-by-service assignment</div>
                <div className="mt-1 text-sm font-semibold leading-6 text-slate-700">Assign each row to a different user. For example: <b className="text-emerald-800">Producer → Sales</b>, <b className="text-sky-800">Brand Owner → Compliance</b>, <b className="text-amber-800">Importer → Operations</b>, independently.</div>
              </div>
              <div className="ml-auto w-full sm:w-56">
                <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-slate-500"><span>Progress</span><span>{assignedCount} / {rows.length}</span></div>
                <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100 ring-1 ring-inset ring-slate-200">
                  <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500 transition-all duration-700" style={{ width: `${progress}%` }} />
                </div>
              </div>
            </div>

            <div className="space-y-3">
              {rows.length === 0 && <div className="rounded-3xl border border-dashed border-slate-300 bg-white px-5 py-10 text-center">
                <div className="mx-auto grid h-14 w-14 place-items-center rounded-3xl bg-slate-50 text-slate-400 ring-1 ring-slate-200"><BriefcaseBusiness className="h-7 w-7" /></div>
                <h3 className="mt-3 text-lg font-black text-slate-900">No services found</h3>
                <p className="mt-1 text-sm font-semibold text-slate-500">This client master does not have any services yet. Save at least one service in Client Master first.</p>
              </div>}
              {rows.map((row) => {
                const theme = getApplicantTheme(row.svc.piboCategory || row.svc.subApplicantType || row.svc.applicantType || '');
                const ApplicantIcon = theme.accentIcon;
                const isChanged = String(values[row.stateKey] || '').trim() !== row.existingUserId;
                return (
                  <article key={`allocation-row-${row.clientId}-${row.idx}`} className={`group relative overflow-hidden rounded-3xl border bg-white p-4 shadow-[0_10px_30px_-15px_rgba(15,23,42,0.12)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_45px_-15px_rgba(15,23,42,0.18)] sm:p-5 ${theme.ring}`}>
                    <div className={`pointer-events-none absolute inset-y-0 left-0 w-1.5 bg-gradient-to-b ${theme.iconBg}`} />
                    <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_280px] sm:items-center">
                      <div className="flex min-w-0 items-start gap-3.5">
                        <div className={`relative grid h-14 w-14 shrink-0 place-items-center rounded-2xl text-white shadow-lg ring-1 ring-white/60 ${theme.iconBg}`}>
                          <div className="absolute inset-0 rounded-2xl bg-gradient-to-tr from-white/30 via-white/0 to-transparent" />
                          <ApplicantIcon className="relative h-7 w-7" strokeWidth={2} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className={`inline-flex items-center rounded-xl px-2.5 py-1 text-[11px] font-black uppercase tracking-wider ring-1 ${theme.badgeBg} ${theme.badgeText} ${theme.badgeRing}`}>
                              {row.svc.piboCategory || row.svc.subApplicantType || row.svc.applicantType || 'Service'}
                            </span>
                            {(row.svc.eprCategory || row.svc.serviceCategory) && <span className="inline-flex items-center rounded-xl bg-slate-50 px-2.5 py-1 text-[11px] font-black text-slate-700 ring-1 ring-slate-200">{row.svc.eprCategory || row.svc.serviceCategory}</span>}
                            {row.svc.servicesOffered && <span className="inline-flex items-center rounded-xl bg-amber-50 px-2.5 py-1 text-[11px] font-black text-amber-800 ring-1 ring-amber-200">{row.svc.servicesOffered}</span>}
                            {isChanged && <span className="inline-flex items-center gap-1 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-white shadow-violet-100 ring-1 ring-white/30"><Sparkles className="h-3 w-3" /> Updated</span>}
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-bold text-slate-500">
                            {row.svc.plantUnit && <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 ring-1 ring-slate-200"><Building2 className="h-3 w-3" /> Plant · {row.svc.plantUnit}</span>}
                            {row.svc.financialYear && <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 ring-1 ring-slate-200"><Gauge className="h-3 w-3" /> FY · {row.svc.financialYear}</span>}
                            {row.existingUserId && row.fallbackText && !row.current && <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-indigo-800 ring-1 ring-indigo-200"><UserCheck className="h-3 w-3" /> Previous · {userMiniDisplay(userById.get(row.existingUserId))}</span>}
                          </div>
                          {row.selectedUser && <div className="mt-2 inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-50 to-teal-50 px-2.5 py-1.5 text-[11px] font-black text-emerald-900 ring-1 ring-emerald-200">
                            <span className="grid h-5 w-5 place-items-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-500 text-white ring-1 ring-white/70"><UserCheck className="h-3 w-3" /></span>
                            Assigned → <span className="truncate">{userDisplay(row.selectedUser)}</span>
                          </div>}
                        </div>
                      </div>
                      <div className="w-full sm:w-72 sm:justify-self-end">
                        <div className="relative">
                          <select
                            value={row.current}
                            onChange={(e) => setValues((prev) => ({ ...prev, [row.stateKey]: String(e.target.value || '') }))}
                            className={`w-full appearance-none rounded-2xl border px-3.5 py-2.5 pr-10 text-sm font-bold text-slate-800 shadow-[0_1px_0_rgba(255,255,255,0.8)_inset,0_6px_20px_-12px_rgba(15,23,42,0.25)] transition focus:outline-none focus:ring-4 ${
                              row.current
                                ? 'border-emerald-300 bg-gradient-to-r from-white to-emerald-50 focus:border-emerald-400 focus:ring-emerald-100'
                                : 'border-slate-200 bg-white hover:border-slate-300 focus:border-emerald-300 focus:ring-emerald-100'
                            }`}
                          >
                            <option value="">— Leave unassigned —</option>
                            {!Array.isArray(users) || users.length === 0 ? (
                              <option value="" disabled>— No staff users loaded · Refresh the page —</option>
                            ) : users.map((u, idx) => (
                              <option key={String(u._id || u.id || `user-${idx}-${u.email || 'anon'}`)} value={String(u._id || u.id || '')}>{userDisplay(u)}</option>
                            ))}
                          </select>
                          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400 group-hover:text-slate-600 transition" />
                        </div>
                        {(!row.current && !row.existingUserId) && <div className="mt-1.5 inline-flex items-center gap-1 rounded-xl bg-rose-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-rose-700 ring-1 ring-rose-200"><CircleAlert className="h-3 w-3" /> Needs allocation</div>}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>

          <aside className="min-w-0">
            <div className="sticky top-6 space-y-4">
              <div className="relative overflow-hidden rounded-3xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-teal-50 p-5 shadow-[0_18px_45px_-20px_rgba(16,185,129,0.35)]">
                <div className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-emerald-300/40 blur-3xl" />
                <div className="flex items-center gap-3">
                  <div className="grid h-11 w-11 place-items-center rounded-2xl bg-white text-emerald-700 ring-1 ring-emerald-200 shadow-sm"><ShieldCheck className="h-5 w-5" /></div>
                  <div>
                    <div className="text-[11px] font-black uppercase tracking-[0.18em] text-emerald-800">Audit trail</div>
                    <div className="text-sm font-black text-emerald-950">Every save is logged</div>
                  </div>
                </div>
                <p className="mt-3 text-xs font-bold leading-5 text-emerald-900/90">Changes write an AuditLog entry with timestamp, manager name, and full allocation snapshot for compliance review.</p>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Allocation summary</div>
                <div className="mt-3 space-y-2.5 text-xs font-bold text-slate-600">
                  <div className="flex items-center justify-between"><span className="inline-flex items-center gap-1.5"><BriefcaseBusiness className="h-3.5 w-3.5 text-slate-400" /> Total services</span><b className="text-slate-900">{rows.length}</b></div>
                  <div className="flex items-center justify-between"><span className="inline-flex items-center gap-1.5"><UserCheck className="h-3.5 w-3.5 text-emerald-600" /> Assigned now</span><b className="text-emerald-800">{rows.filter((r) => r.current).length}</b></div>
                  <div className="flex items-center justify-between"><span className="inline-flex items-center gap-1.5"><Percent className="h-3.5 w-3.5 text-violet-600" /> Changed rows</span><b className="text-violet-800">{rows.filter((r) => String(values[r.stateKey] || '').trim() !== r.existingUserId).length}</b></div>
                  <div className="flex items-center justify-between"><span className="inline-flex items-center gap-1.5"><Users className="h-3.5 w-3.5 text-sky-600" /> Eligible staff</span><b className="text-sky-800">{users.length}</b></div>
                </div>
                <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-slate-100 ring-1 ring-inset ring-slate-200">
                  <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500 transition-all duration-700" style={{ width: `${progress}%` }} />
                </div>
                <div className="mt-1.5 text-right text-[10px] font-black uppercase tracking-widest text-slate-500">{progress}% complete</div>
              </div>

              <div className="rounded-3xl border border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 p-5 shadow-[0_18px_45px_-20px_rgba(251,146,60,0.25)]">
                <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.18em] text-amber-800"><Sparkles className="h-3.5 w-3.5" /> Pro tip</div>
                <p className="mt-2 text-xs font-bold leading-5 text-amber-900/90">A client with Producer + Brand Owner + Importer can be split across 3 different CRM users. Use the dropdown per row independently.</p>
              </div>
            </div>
          </aside>
        </div>

        <footer className="relative flex flex-wrap items-center justify-end gap-2.5 border-t border-slate-100 bg-gradient-to-r from-white/90 via-slate-50/90 to-white/90 px-6 py-4 sm:px-8 sm:py-5">
          <button type="button" onClick={onClose} disabled={saving} className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-200 bg-white px-5 py-2.5 text-xs font-black text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md disabled:opacity-50 disabled:hover:translate-y-0">Cancel</button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving || rows.length === 0}
            className="group/save relative inline-flex items-center gap-2 overflow-hidden rounded-2xl bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 px-6 py-2.5 text-xs font-black text-white shadow-[0_18px_45px_-10px_rgba(16,185,129,0.65)] ring-1 ring-white/30 transition hover:-translate-y-0.5 hover:shadow-[0_24px_60px_-10px_rgba(16,185,129,0.8)] disabled:opacity-60 disabled:hover:translate-y-0"
          >
            <span className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-white/30 via-white/0 to-transparent" />
            {saving ? (<RefreshCw className="relative h-4 w-4 animate-spin" />) : (<Check className="relative h-4 w-4" strokeWidth={2.4} />)}
            <span className="relative">{saving ? 'Saving allocations…' : 'Save Allocations'}</span>
          </button>
        </footer>
      </div>
    </div>
  );
}

function ToastNotification({ toast, onClose }) {
  const isSuccess = toast.kind === 'success';
  const icon = isSuccess ? CheckCircle2 : CircleAlert;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[120] flex justify-center px-4 sm:bottom-10">
      <div className={`pointer-events-auto relative flex w-full max-w-lg overflow-hidden rounded-3xl p-1 shadow-[0_30px_70px_rgba(15,23,42,0.2)] ring-1 ${isSuccess ? 'bg-gradient-to-br from-emerald-500/10 to-teal-500/10 ring-emerald-200' : 'bg-gradient-to-br from-rose-500/10 to-pink-500/10 ring-rose-200'}`} onClick={onClose} role="status" aria-live="polite">
        <div className="flex w-full items-start gap-3 rounded-[22px] bg-white/95 px-4 py-3.5 backdrop-blur">
          <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-2xl text-white shadow-lg ring-1 ring-white/60 ${isSuccess ? 'bg-gradient-to-br from-emerald-500 to-teal-500' : 'bg-gradient-to-br from-rose-500 to-pink-500'}`}><icon className="h-5 w-5" strokeWidth={2.2} /></div>
          <div className="min-w-0 flex-1">
            <div className={`text-[11px] font-black uppercase tracking-[0.18em] ${isSuccess ? 'text-emerald-700' : 'text-rose-700'}`}>{isSuccess ? 'Success' : 'Issue'}</div>
            <div className="mt-0.5 truncate text-sm font-black text-slate-900">{toast.title}</div>
            <div className="mt-0.5 truncate text-xs font-semibold text-slate-500">{toast.message}</div>
          </div>
          <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl ${isSuccess ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100' : 'bg-rose-50 text-rose-700 ring-1 ring-rose-100'}`}><X className="h-4 w-4" /></div>
        </div>
      </div>
    </div>
  );
}
