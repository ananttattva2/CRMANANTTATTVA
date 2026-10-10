import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { Building2, CheckCircle2, ChevronDown, Download, Edit3, Eye, FileCheck2, FileText, FolderCheck, Plus, RefreshCw, Search, UserCheck, X } from 'lucide-react';
import { DeactivationButton } from './ClientDeactivation';
import api from '../../services/api';
import ToastMessage from '../../components/ToastMessage';
import { companyPoClosed, clientPoExportEntries, clientPoCounts, sumClientPoCounts, clientFinancialYears, clientPoDates, poDatesLabel, poDateFinancialYears } from './clientPoStatus.mjs';
import { clientLeadOwner } from './clientLeadOwner.mjs';
import {
  getAssignedName,
  getAssignedStaffNames,
  getCpcbStatus,
  getClientUniqueId,
  getFirstAnnualReturnYear,
  getMsmeRows,
  getMsmeSummary,
  getVisibilityStatus,
  matchesAssignedStaff,
  readClientData
} from './clientMaster.utils';

function buildStaffFilterOptions(staff = [], clients = []) {
  const options = new Map();
  const add = (value, label, preferred = false) => {
    const normalizedLabel = normalizeClientSearchText(label);
    if (!value || !normalizedLabel) return;
    const current = options.get(normalizedLabel);
    if (!current || preferred) options.set(normalizedLabel, { value: String(value), label: String(label).trim() });
  };
  staff.forEach((user) => {
    const id = user._id || user.id || user.name || user.email;
    const label = user.name || user.email;
    add(id, label, true);
  });
  clients.forEach((item) => {
    const label = getAssignedName(item, staff);
    if (label && label !== '-') add(`name:${label}`, label);
  });
  return [...options.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function normalizeClientSearchText(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function collectClientSearchValues(value, values = [], depth = 0) {
  if (value === null || value === undefined || depth > 4) return values;
  if (['string', 'number', 'boolean'].includes(typeof value)) {
    const text = String(value).trim();
    if (text) values.push(text);
    return values;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectClientSearchValues(item, values, depth + 1));
    return values;
  }
  if (typeof value === 'object') {
    Object.values(value).forEach((item) => collectClientSearchValues(item, values, depth + 1));
  }
  return values;
}

function clientMatchesSearch(item, term, staff = []) {
  const normalizedTerm = normalizeClientSearchText(term);
  if (!normalizedTerm) return true;
  const data = readClientData(item);
  const compactTerm = normalizedTerm.replace(/\s+/g, '');
  const haystack = normalizeClientSearchText([
    getClientUniqueId(item),
    item.clientName,
    item.companyName,
    item.company,
    item.name,
    item.tradeName,
    item.basic?.clientLegalName,
    item.basic?.tradeName,
    item.selectedLead?.company,
    item.selectedLead?.companyName,
    item.selectedLead?.leadCode,
    item.createdBy?.name,
    item.createdBy?.email,
    data.basic?.clientLegalName,
    data.basic?.tradeName,
    data.basic?.companyName,
    data.registeredAddress?.address1,
    data.registeredAddress?.address2,
    data.registeredAddress?.city,
    data.registeredAddress?.state,
    data.registeredAddress?.pincode,
    data.communicationAddress?.address1,
    data.communicationAddress?.city,
    data.communicationAddress?.state,
    getVisibilityStatus(item),
    getAssignedName(item, staff),
    clientLeadOwner(item, staff),
    ...getAssignedStaffNames(item, staff),
    data.basic?.piboCategory,
    data.basic?.eprCategory,
    getMsmeSummary(data),
    data.cpcb?.status,
    data.otp?.mobile,
    data.otp?.personName,
    ...collectClientSearchValues(data.importMeta),
    ...collectClientSearchValues(item.selectedLead)
  ].filter(Boolean).join(' '));
  const compactHaystack = haystack.replace(/\s+/g, '');
  return haystack.includes(normalizedTerm) ||
    compactHaystack.includes(compactTerm);
}

function directoryClientIdentity(item = {}) {
  const data = readClientData(item);
  const uniqueId = getClientUniqueId(item).replace(/^-$/, '').trim().toLowerCase();
  if (uniqueId) return `unique:${uniqueId}`;
  const leadId = String(item.selectedLead?._id || item.selectedLead || data.selectedLead || '').trim().toLowerCase();
  if (leadId) return `lead:${leadId}`;
  const company = normalizeClientSearchText(data.basic?.clientLegalName || data.basic?.tradeName || item.companyName || item.company).replace(/\s+/g, '');
  return company ? `company:${company}` : `record:${item._id || item.id || ''}`;
}

function dedupeDirectoryClients(clients = []) {
  const grouped = new Map();
  clients.forEach((item) => {
    const key = directoryClientIdentity(item);
    const data = readClientData(item);
    const score = (String(item.workflowStatus || '').toLowerCase() === 'submitted' ? 1000 : 0)
      + [data.basic?.clientLegalName, data.basic?.tradeName, data.registeredAddress?.state, data.cpcb?.status].filter(Boolean).length;
    const current = grouped.get(key);
    if (!current || score > current.score) grouped.set(key, { item, score });
  });
  return [...grouped.values()].map(({ item }) => item);
}

function ClientDirectoryView({ clients, pagination, summary, staff, loading, error, notice, onRefresh, onDirectoryQueryChange, onExportAll, onView, onEdit, onCreate, canEdit = false, selectOptions = {}, totalClientCount }) {
  const [deactivationStatuses, setDeactivationStatuses] = useState([]);
  const [query, setQuery] = useState('');
  const [visibilityFilter, setVisibilityFilter] = useState('');
  const [staffFilter, setStaffFilter] = useState('');
  const [metricFilter, setMetricFilter] = useState('');
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [page, setPage] = useState(1);
  const directoryEffectReady = useRef(false);
  const previousDirectoryFilterRef = useRef('');

  const directoryClients = useMemo(() => dedupeDirectoryClients(clients), [clients]);
  const filteredClients = directoryClients;
  useEffect(() => {
    let active = true;
    api.get('/clients/deactivation-status').then((response) => { if (active) setDeactivationStatuses(response.data.statuses || []); }).catch(() => {});
    return () => { active = false; };
  }, [clients]);

  useEffect(() => {
    if (!directoryEffectReady.current) {
      directoryEffectReady.current = true;
      previousDirectoryFilterRef.current = JSON.stringify([metricFilter, query, rowsPerPage, staffFilter, visibilityFilter]);
      return undefined;
    }
    const filterKey = JSON.stringify([metricFilter, query, rowsPerPage, staffFilter, visibilityFilter]);
    if (filterKey !== previousDirectoryFilterRef.current) {
      previousDirectoryFilterRef.current = filterKey;
      if (page !== 1) {
        setPage(1);
        return undefined;
      }
    }
    const timer = window.setTimeout(() => {
      onDirectoryQueryChange({
        page,
        limit: rowsPerPage,
        search: query.trim(),
        visibilityStatus: visibilityFilter,
        staff: staffFilter,
        metric: metricFilter
      });
    }, query.trim() ? 400 : 0);
    return () => window.clearTimeout(timer);
  }, [metricFilter, onDirectoryQueryChange, page, query, rowsPerPage, staffFilter, visibilityFilter]);

  const totalPages = Math.max(1, Number(pagination?.totalPages || 1));
  const visibleClients = filteredClients;
  const staffFilterOptions = useMemo(() => buildStaffFilterOptions(staff, directoryClients), [directoryClients, staff]);
  const metricStats = useMemo(() => {
    return [
      { label: 'Live Applications', value: Number(summary?.total || totalClientCount || 0), note: 'Accessible client records', icon: Building2, tone: 'emerald', filter: 'live' },
      { label: 'Annual Return', value: Number(summary?.annual || 0), note: 'Return year mapped', icon: FileText, tone: 'violet', filter: 'annual' },
      { label: 'Processed Apps', value: Number(summary?.processed || 0), note: 'CPCB approved', icon: CheckCircle2, tone: 'teal', filter: 'processed' },
      { label: 'Pending Apps', value: Number(summary?.pending || 0), note: 'ATPL pending', icon: FileCheck2, tone: 'amber', filter: 'pending' },
      { label: 'In Progress', value: Number(summary?.progress || 0), note: 'Portal review', icon: RefreshCw, tone: 'sky', filter: 'progress' },
      { label: 'Rejected', value: Number(summary?.rejected || 0), note: 'Portal rejected', icon: X, tone: 'rose', filter: 'rejected' },
      { label: 'Discontinued', value: Number(summary?.discontinued || 0), note: 'Hidden or archived', icon: FolderCheck, tone: 'orange', filter: 'discontinued' }
    ];
  }, [summary, totalClientCount]);
  const selectedMetric = metricStats.find((stat) => stat.filter === metricFilter);

  async function exportExcel() {
    const exportClients = await onExportAll({
      search: query.trim(), visibilityStatus: visibilityFilter, staff: staffFilter, metric: metricFilter
    }).catch(() => filteredClients);
    const rows = exportClients.map((item) => {
      const data = readClientData(item);
      const poCounts = clientPoCounts(item);
      return {
        'PO Date': poDatesLabel(clientPoDates(item)),
        'Financial Year': poDateFinancialYears(clientPoDates(item)).join(', ') || 'Not Recorded',
        'Service Financial Year': clientFinancialYears(item).join(', ') || 'Not Recorded',
        'PO Approved Count': poCounts.approved,
        'PO Pending Count': poCounts.pending,
        'PO Rejected Count': poCounts.rejected,
        'Unique ID': getClientUniqueId(item).replace(/^-$/, ''),
        'Trade Name': data.basic?.tradeName || '',
        'Lead Note': data.importMeta?.leadNote || '',
        'Lead Number': data.importMeta?.leadNumber || item.selectedLead?.leadCode || '',
        'Client Status': data.importMeta?.clientStatus || item.workflowStatus || '',
        'Visibility Status': getVisibilityStatus(item),
        'PO Close': companyPoClosed(item) ? 'Yes' : 'No',
        'Lead Close': companyPoClosed(item) ? 'Yes' : 'No',
        'Created By': data.importMeta?.createdBy || '',
        'Creation Date': data.importMeta?.creationDate || item.createdAt || '',
        'Assigned To': getAssignedName(item, staff).replace(/^-$/, ''),
        'Lead Owner': clientLeadOwner(item, staff).replace(/^-$/, ''),
        'Manager Assigned to Staff': getAssignedStaffNames(item, staff).join(', '),
        'Client Name': data.basic?.clientLegalName || '',
        State: data.registeredAddress?.state || '',
        'City with PIN': `${data.registeredAddress?.city || ''} ${data.registeredAddress?.pincode || ''}`.trim(),
        'Contact Person': data.otp?.personName || data.authorised?.name || '',
        Email: data.authorised?.email || data.coordinating?.email || '',
        'Company Industry': data.basic?.companyIndustry || '',
        'PIBO Category': data.basic?.piboCategory || '',
        'Services Offered': data.basic?.servicesOffered || '',
        'Contact No': data.otp?.mobile || data.authorised?.mobile || '',
        Website: data.basic?.website || '',
        'GST Number': data.compliance?.gst || '',
        'GST Certificate Date': data.compliance?.gstDate || '',
        CIN: data.compliance?.cin || '',
        'CIN Document Date': data.compliance?.cinDate || '',
        PAN: data.compliance?.pan || '',
        'PAN Document Date': data.compliance?.panDate || '',
        'Factory License No': data.compliance?.factoryLicense || '',
        'Factory License Document Date': data.compliance?.factoryLicenseDate || '',
        'Brand Owner Production Facility': data.compliance?.brandOwnerProductionFacility || (data.compliance?.factoryLicenseApplicability === 'Applicable' ? 'Yes' : 'No'),
        'MSME 1': getMsmeRows(data)?.[0]?.value || getMsmeRows(data)?.[0]?.udyamNumber || '',
        'MSME 2': getMsmeRows(data)?.[1]?.value || getMsmeRows(data)?.[1]?.udyamNumber || '',
        'MSME 3': getMsmeRows(data)?.[2]?.value || getMsmeRows(data)?.[2]?.udyamNumber || '',
        'MSME 4': getMsmeRows(data)?.[3]?.value || getMsmeRows(data)?.[3]?.udyamNumber || '',
        'MSME 5': getMsmeRows(data)?.[4]?.value || getMsmeRows(data)?.[4]?.udyamNumber || '',
        'CPCB Reg No': data.cpcb?.registrationNumber || '',
        'CPCB Status': data.cpcb?.status || '',
        'CEPR User ID': data.cpcb?.ceprUserId || '',
        'CEPR Password': data.cpcb?.ceprPassword || '',
        'CPCB Login': data.cpcb?.loginId || '',
        'CPCB Password': data.cpcb?.loginPassword || '',
        'Service Category': data.basic?.eprCategory || '',
        'EPR Certificate No': data.compliance?.eprCertificate || '',
        'Approval Status': item.adminControls?.approvalStatus || '',
        'Approved By': data.importMeta?.approvedBy || '',
        'OTP Mobile': data.otp?.mobile || '',
        'OTP Name': data.otp?.personName || '',
        'Reg Address Line 1': data.registeredAddress?.address1 || '',
        'Reg Address Line 2': data.registeredAddress?.address2 || '',
        'Reg Address Line 3': data.registeredAddress?.address3 || '',
        'Reg City': data.registeredAddress?.city || '',
        'Reg State': data.registeredAddress?.state || '',
        'Reg PIN': data.registeredAddress?.pincode || '',
        'Comm Address Line 1': data.communicationAddress?.address1 || '',
        'Comm Address Line 2': data.communicationAddress?.address2 || '',
        'Comm Address Line 3': data.communicationAddress?.address3 || '',
        'Comm City': data.communicationAddress?.city || '',
        'Comm State': data.communicationAddress?.state || '',
        'Comm PIN': data.communicationAddress?.pincode || '',
        'Document URLs (max 5)': (data.validation?.documentUrls || []).join(', '),
        'Auth Person Name': data.authorised?.name || '',
        'Auth Person Designation': data.authorised?.designation || '',
        'Auth Person Mobile': data.authorised?.mobile || '',
        'Auth Person Email': data.authorised?.email || '',
        'Coord Person Name': data.coordinating?.name || '',
        'Coord Person Designation': data.coordinating?.designation || '',
        'Coord Person Mobile': data.coordinating?.mobile || '',
        'Coord Person Email': data.coordinating?.email || ''
      };
    });
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Clients');
    const poEntries = clientPoExportEntries(exportClients);
    const serviceRows = poEntries.map(({ item, service }) => {
      const data = readClientData(item);
      return {
        'Unique ID': getClientUniqueId(item).replace(/^-$/, ''),
        'Client Name': data.basic?.clientLegalName || item.selectedLead?.company || '',
        'Lead Number': data.importMeta?.leadNumber || item.selectedLead?.leadCode || '',
        'Company PO Close': companyPoClosed(item) ? 'Yes' : 'No',
        'Company Lead Close': companyPoClosed(item) ? 'Yes' : 'No',
        'Lead Owner': clientLeadOwner(item, staff).replace(/^-$/, ''),
        'PO Approved Count': service.poCounts.approved,
        'PO Pending Count': service.poCounts.pending,
        'PO Rejected Count': service.poCounts.rejected,
        'PO Date': poDatesLabel(service.poDates),
        'Financial Year': service.poDateFinancialYears.join(', ') || 'Not Recorded',
        'Service Financial Year': service.financialYears.join(', ') || 'Not Recorded',
        'PO Financial Year': service.poFinancialYears.join(', ') || 'Not Recorded',
        'Annual Return Year': service.annualReturnYears.join(', ') || 'Not Recorded',
        'Service No': service.index,
        'Service ID': service.id,
        'Applicant Type': service.applicantType,
        'Sub Applicant Type': service.subApplicantType,
        'Service Category': service.category,
        'Services Offered': service.name,
        'PO Close': service.closed ? 'Yes' : 'No',
        'Lead Close': service.closed ? 'Yes' : 'No',
        'PO Received': service.received ? 'Yes' : 'No'
      };
    });
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(serviceRows), 'Service PO Status');
    const totals = sumClientPoCounts(poEntries.map(({ service }) => service.poCounts));
    const summaryRows = [['Approved', totals.approved], ['Pending', totals.pending], ['Rejected', totals.rejected], ['Revision Required', totals.revision], ['Status Not Recorded', totals.unrecorded], ['Total', totals.total]].map(([status, count]) => ({ 'PO Status': status, 'PO Count': count }));
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summaryRows), 'PO Approval Summary');
    XLSX.writeFile(workbook, 'clients.xlsx');
  }

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <div className="space-y-7">
        <ClientStoryStats
          stats={metricStats.slice(0, 1)}
          activeFilter={metricFilter}
          onFilterChange={(filter) => setMetricFilter((current) => (current === filter ? '' : filter))}
        />
        {selectedMetric && <ClientMetricOutputCard stat={selectedMetric} clients={filteredClients} onClose={() => setMetricFilter('')} onExport={exportExcel} />}
        {error && <ToastMessage type="error">{error}</ToastMessage>}
        {notice && <ToastMessage type="success">{notice}</ToastMessage>}

        <div className="client-directory-toolbar grid gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm xl:grid-cols-[minmax(240px,1.2fr)_minmax(210px,0.8fr)_minmax(190px,0.8fr)_auto] xl:items-center">
          <div className="relative min-w-0">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search" className="h-12 w-full rounded-lg border border-slate-200 bg-white px-5 pr-12 text-base font-black text-slate-900 outline-none placeholder:text-slate-400 focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100" />
            <Search className="pointer-events-none absolute right-6 top-1/2 h-6 w-6 -translate-y-1/2 text-slate-400" />
          </div>
          <ClientFilterSelect
            value={visibilityFilter}
            onChange={setVisibilityFilter}
            placeholder="All Visibility Status"
            label="Visibility status"
            type="status"
            options={(selectOptions.visibilityStatus || []).map((item) => ({ value: item, label: item }))}
          />
          <ClientFilterSelect value={staffFilter} onChange={setStaffFilter} placeholder="All Staff" label="Staff filter" type="staff" searchable options={staffFilterOptions} />
          <div className="grid grid-cols-2 gap-2 xl:flex xl:justify-end">
            <button type="button" onClick={onCreate} className="btn-lift inline-flex h-12 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-[#30737B] px-4 text-sm font-black text-white shadow-lg shadow-teal-900/20"><Plus className="h-4 w-4" />Add Client Master</button>
            <button type="button" onClick={() => { setQuery(''); setVisibilityFilter(''); setStaffFilter(''); setMetricFilter(''); setPage(1); }} className="btn-lift inline-flex h-12 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-4 text-sm font-black text-slate-600 hover:bg-slate-50"><X className="h-4 w-4" />Clear</button>
            <button type="button" onClick={onRefresh} className="btn-lift inline-flex h-12 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-orange-200 bg-white px-4 text-sm font-black text-orange-600 hover:bg-orange-50"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh</button>
            <button type="button" onClick={exportExcel} className="btn-lift inline-flex h-12 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-emerald-600 px-4 text-sm font-black text-white shadow-lg shadow-emerald-600/20"><Download className="h-4 w-4" />Export</button>
          </div>
        </div>

        <DirectoryTableHeader showing={visibleClients.length} total={Number(pagination?.total || totalClientCount || 0)} label="clients" rowsPerPage={rowsPerPage} setRowsPerPage={setRowsPerPage} page={page} setPage={setPage} totalPages={totalPages} />
        <div className="client-directory-table-shell overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="hidden-scrollbar max-h-[520px] overflow-auto">
            <table className="crm-data-table w-full min-w-[1600px] table-fixed text-left text-sm">
              <thead className="sticky top-0 z-10 bg-slate-50 text-xs font-black uppercase tracking-[0.06em] text-slate-500 shadow-sm">
                <tr>
                  {['Unique ID', 'Legal Name', 'Trade Name', 'State', 'Lead Owner', 'Assigned To', 'Visibility Status', 'PO Close', 'Service Category', 'MSME', 'CPCB Approval', 'Manager Assigned to Staff', 'Actions'].map((header) => <th key={header} className={`px-5 py-4 ${header === 'Actions' ? 'w-56' : ''}`}>{header}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {visibleClients.length === 0 ? (
                  loading ? <ClientTableLoadingRows /> : <tr><td colSpan={13} className="px-5 py-12 text-center font-black text-slate-400">No clients found.</td></tr>
                ) : visibleClients.map((item) => {
                  const data = readClientData(item);
                  const lifecycle = deactivationStatuses.find((row) => row.clientIds.includes(String(item._id || item.id)));
                  const locked = lifecycle && lifecycle.status !== 'REJECTED';
                  return (
                    <tr key={item._id || item.id} className="transition hover:bg-orange-50/60">
                      <td className="px-5 py-4 font-black text-slate-900"><span className="cell-clip">{getClientUniqueId(item)}</span></td>
                      <td className="px-5 py-4 font-black uppercase text-slate-600"><span className="cell-clamp">{data.basic?.clientLegalName || '-'}</span></td>
                      <td className="px-5 py-4 font-black uppercase text-slate-500"><span className="cell-clamp">{data.basic?.tradeName || '-'}</span></td>
                      <td className="px-5 py-4 font-black uppercase text-slate-500"><span className="cell-clip">{data.registeredAddress?.state || '-'}</span></td>
                      <td className="px-5 py-4 font-black uppercase text-slate-500"><span className="cell-clamp" title={clientLeadOwner(item, staff)}>{clientLeadOwner(item, staff)}</span></td>
                      <td className="px-5 py-4 font-black uppercase text-slate-500"><span className="cell-clip">{getAssignedName(item, staff)}</span></td>
                      <td className="px-5 py-4"><span className="rounded-full bg-emerald-50 px-4 py-2 text-xs font-black text-emerald-700">{lifecycle?.status === 'INACTIVE' ? 'Inactive' : locked ? 'Deactivation Pending' : getVisibilityStatus(item)}</span></td>
                      <td className="px-5 py-4"><span title="Yes if at least one service PO is closed" className={`rounded-full px-3 py-2 text-xs font-black ${companyPoClosed(item) ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{companyPoClosed(item) ? 'Yes' : 'No'}</span></td>
                      <td className="px-5 py-4 font-black uppercase text-slate-500"><span className="cell-clamp">{data.basic?.eprCategory || '-'}</span></td>
                      <td className="px-5 py-4 font-black uppercase text-slate-500"><span className="cell-clip">{getMsmeSummary(data)}</span></td>
                      <td className="px-5 py-4 font-black uppercase text-slate-500"><span className="cell-clip">{getCpcbStatus(data)}</span></td>
                      <td className="px-5 py-4 font-black uppercase text-slate-500"><span className="cell-clamp">{getAssignedStaffNames(item, staff).join(', ') || '-'}</span></td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2">
                          <button type="button" onClick={() => onView(item)} className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50" title="View"><Eye className="h-4 w-4" /></button>
                          {!locked && <DeactivationButton clientId={item._id || item.id} onChanged={onRefresh} />}
                          {canEdit && !locked && <button type="button" onClick={() => onEdit(item)} className="grid h-9 w-9 place-items-center rounded-lg border border-orange-200 bg-orange-50 text-orange-600 hover:bg-orange-100" title="Edit Client Master" aria-label="Edit Client Master"><Edit3 className="h-4 w-4" /></button>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function ClientFilterSelect({ value, options, onChange, placeholder, label, type, searchable = false }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const rootRef = useRef(null);
  const selected = options.find((option) => String(option.value) === String(value));
  const filtered = options.filter((option) => option.label.toLowerCase().includes(search.trim().toLowerCase()));

  useEffect(() => {
    function closeOnOutsideClick(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, []);

  function choose(nextValue) {
    onChange(nextValue);
    setOpen(false);
    setSearch('');
  }

  return (
    <div ref={rootRef} className={`client-filter-select ${open ? 'is-open' : ''}`}>
      <button type="button" className="client-filter-trigger" onClick={() => setOpen((current) => !current)} aria-haspopup="listbox" aria-expanded={open}>
        <span className={`client-filter-icon is-${type}`}>{type === 'staff' ? <UserCheck className="h-4 w-4" /> : <span className={`client-status-dot is-${String(value || 'all').toLowerCase().replace(/\s+/g, '-')}`} />}</span>
        <span className="client-filter-copy"><small>{label}</small><strong>{selected?.label || placeholder}</strong></span>
        <ChevronDown className="client-filter-chevron h-4 w-4" />
      </button>
      {open && (
        <div className="client-filter-menu">
          {searchable && <div className="client-filter-search"><Search className="h-4 w-4" /><input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search staff..." />{search && <button type="button" onClick={() => setSearch('')} aria-label="Clear search"><X className="h-4 w-4" /></button>}</div>}
          <div className="client-filter-options" role="listbox">
            {!search && <button type="button" role="option" aria-selected={!value} className="client-filter-option" onClick={() => choose('')}><span className={`client-filter-option-mark is-${type}`}>{type === 'staff' ? <UserCheck className="h-4 w-4" /> : <span className="client-status-dot is-all" />}</span><strong>{placeholder}</strong>{!value && <CheckCircle2 className="h-4 w-4" />}</button>}
            {filtered.map((option) => <button key={option.value} type="button" role="option" aria-selected={String(option.value) === String(value)} className="client-filter-option" onClick={() => choose(option.value)}><span className={`client-filter-option-mark is-${type}`}>{type === 'staff' ? option.label.slice(0, 1).toUpperCase() : <span className={`client-status-dot is-${option.label.toLowerCase().replace(/\s+/g, '-')}`} />}</span><strong>{option.label}</strong>{String(option.value) === String(value) && <CheckCircle2 className="h-4 w-4" />}</button>)}
            {!filtered.length && search && <div className="client-filter-empty">No staff member found</div>}
          </div>
          <div className="client-filter-foot">{filtered.length} option{filtered.length === 1 ? '' : 's'}</div>
        </div>
      )}
    </div>
  );
}

function useCountUp(value, active, duration = 850) {
  const [displayValue, setDisplayValue] = useState(active ? value : 0);

  useEffect(() => {
    if (!active) {
      setDisplayValue(0);
      return undefined;
    }

    const start = performance.now();
    const to = Number(value) || 0;
    let frameId;

    function tick(now) {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayValue(Math.round(to * eased));
      if (progress < 1) frameId = requestAnimationFrame(tick);
    }

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [active, duration, value]);

  return displayValue;
}

function ClientStoryStats({ stats, activeFilter, onFilterChange }) {
  const [visibleCount, setVisibleCount] = useState(1);

  useEffect(() => {
    setVisibleCount(1);
    const timers = stats.slice(1).map((_, index) =>
      window.setTimeout(() => setVisibleCount(index + 2), 500 * (index + 1))
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [stats.length]);

  return (
    <section className="lead-story-panel client-story-panel">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.22em] text-emerald-700">Client Performance Flow</p>
          <h2 className="mt-2 text-3xl font-black text-slate-950">Live client movement</h2>
        </div>
        <p className="max-w-xl text-sm font-bold text-slate-500">
          Quick client status snapshot for applications, CPCB progress, and visibility state.
        </p>
      </div>

      <div className="client-story-grid mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-7 xl:gap-5">
        {stats.map((stat, index) => (
          <ClientStoryCard
            key={stat.label}
            stat={stat}
            index={index}
            active={index < visibleCount}
            selected={Boolean(stat.filter && activeFilter === stat.filter)}
            onSelect={stat.filter ? () => onFilterChange(stat.filter) : undefined}
            showArrow={index < stats.length - 1}
            arrowActive={index < visibleCount - 1}
          />
        ))}
      </div>
    </section>
  );
}

function ClientStoryCard({ stat, index, active, selected, onSelect, showArrow, arrowActive }) {
  const Icon = stat.icon;
  const value = useCountUp(stat.value, active);
  const Component = onSelect ? 'button' : 'article';

  return (
    <Component type={onSelect ? 'button' : undefined} onClick={onSelect} className={`lead-story-card client-story-card lead-story-${stat.tone} ${active ? 'lead-story-card-active' : ''} ${selected ? 'lead-story-card-selected' : ''}`} style={{ '--delay': `${index * 80}ms` }}>
      {showArrow && <span className={`lead-story-arrow ${arrowActive ? 'lead-story-arrow-active' : ''}`} />}
      <div className="lead-story-topline" />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">{stat.label}</p>
          <p className="count-up-number mt-2 text-3xl font-black text-slate-950">{value}</p>
        </div>
        <span className="lead-story-icon">
          <Icon className="h-5 w-5" />
        </span>
      </div>
      <p className="mt-3 text-[10px] font-black uppercase leading-4 text-slate-500">{stat.note}</p>
    </Component>
  );
}

function ClientMetricOutputCard({ stat, clients, onClose, onExport }) {
  const Icon = stat.icon;
  const preview = clients.slice(0, 10);

  return (
    <section className={`metric-output-card lead-story-${stat.tone}`}>
      <div className="flex flex-col gap-4 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className="lead-story-icon"><Icon className="h-5 w-5" /></span>
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Selected Output</p>
            <h3 className="truncate text-xl font-black text-slate-950">{stat.label}</h3>
          </div>
          <span className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-black text-slate-700">{clients.length} records</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onExport} className="btn-lift inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-black text-white shadow-lg shadow-emerald-600/20"><Download className="h-4 w-4" /> Export</button>
          <button type="button" onClick={onClose} className="btn-lift inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-black text-slate-600 hover:bg-slate-50"><X className="h-4 w-4" /> Close</button>
        </div>
      </div>
      <div className="hidden-scrollbar max-h-[320px] overflow-auto">
        <table className="crm-data-table w-full min-w-[760px] table-fixed text-left text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50 text-xs font-black uppercase tracking-[0.06em] text-slate-500">
            <tr>{['Unique ID', 'Legal Name', 'State', 'Visibility', 'CPCB'].map((header) => <th key={header} className="px-4 py-3">{header}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {preview.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center font-black text-slate-400">No records found.</td></tr>
            ) : preview.map((item) => {
              const data = readClientData(item);
              return (
                <tr key={item._id || item.id} className="transition hover:bg-orange-50/60">
                  <td className="px-4 py-3 font-black text-slate-900"><span className="cell-clip">{getClientUniqueId(item)}</span></td>
                  <td className="px-4 py-3 font-black uppercase text-slate-600"><span className="cell-clamp">{data.basic?.clientLegalName || '-'}</span></td>
                  <td className="px-4 py-3 font-black uppercase text-slate-500"><span className="cell-clip">{data.registeredAddress?.state || '-'}</span></td>
                  <td className="px-4 py-3"><span className="rounded-lg bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">{getVisibilityStatus(item)}</span></td>
                  <td className="px-4 py-3 font-black uppercase text-slate-500"><span className="cell-clip">{data.cpcb?.status || '-'}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {clients.length > preview.length && <p className="border-t border-slate-100 px-4 py-3 text-sm font-bold text-slate-500">Showing first {preview.length} records here. Export includes all {clients.length} filtered records.</p>}
    </section>
  );
}


function ClientTableLoadingRows() {
  return Array.from({ length: 6 }, (_, rowIndex) => (
    <tr key={rowIndex} className="client-table-loading-row">
      {Array.from({ length: 13 }, (_, cellIndex) => (
        <td key={cellIndex} className="px-5 py-4">
          <span
            className={`table-skeleton ${cellIndex === 1 || cellIndex === 2 || cellIndex === 6 ? 'table-skeleton-wide' : ''} ${cellIndex === 12 ? 'table-skeleton-action' : ''}`}
          />
        </td>
      ))}
    </tr>
  ));
}

function DirectoryMetric({ label, value, note }) {
  return (
    <div className="min-h-36 rounded-lg border border-slate-200 bg-white p-5 shadow-sm shadow-slate-900/5">
      <p className="text-sm font-black text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-black text-slate-950">{value}</p>
      {note && <p className="mt-6 text-xs font-black uppercase text-slate-500">{note}</p>}
    </div>
  );
}

function DirectoryTableHeader({ showing, total, label, rowsPerPage, setRowsPerPage, page, setPage, totalPages }) {
  const start = total ? (page - 1) * rowsPerPage + 1 : 0;
  const end = total ? start + showing - 1 : 0;
  const [draftPage, setDraftPage] = useState(String(page));

  useEffect(() => {
    setDraftPage(String(page));
  }, [page]);

  function jumpToPage(event) {
    event.preventDefault();
    const nextPage = Math.min(totalPages, Math.max(1, Number.parseInt(draftPage, 10) || 1));
    setPage(nextPage);
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="font-black text-slate-600">Showing {showing} of {total} {label} <span className="ml-2">(Page {page} of {totalPages})</span></p>
      <div className="flex flex-wrap items-center gap-3 font-black text-slate-600">
        <span>{start} - {end} of {total}</span>
        <form onSubmit={jumpToPage} className="inline-flex items-center gap-2">
          <span>Go to:</span>
          <input value={draftPage} onChange={(event) => setDraftPage(event.target.value)} className="h-11 w-20 rounded-lg border border-slate-200 bg-white px-3 text-center font-black outline-none focus:border-emerald-400" inputMode="numeric" />
        </form>
        <span>Rows per page:</span>
        <select value={rowsPerPage} onChange={(event) => setRowsPerPage(Number(event.target.value))} className="h-11 rounded-lg border border-slate-200 bg-white px-3 font-black outline-none">
          {[10, 25, 50, 100].map((count) => <option key={count} value={count}>{count}</option>)}
        </select>
      </div>
    </div>
  );
}



export default ClientDirectoryView;

