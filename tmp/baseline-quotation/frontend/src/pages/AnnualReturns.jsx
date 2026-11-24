import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BarChart3, CalendarDays, CheckCircle2, ChevronDown, Clock3, Eye, FileText, RefreshCw, Search, Upload } from 'lucide-react';
import * as XLSX from 'xlsx';
import { useNavigate } from 'react-router-dom';
import DashboardShell from '../components/dashboard/DashboardShell';
import ProfileModal from '../components/dashboard/ProfileModal';
import api from '../services/api';
import { API_ENDPOINTS } from '../services/apiEndpoints';
import { formatDisplayDate } from '../utils/dateFormat';

function display(value, fallback = '-') {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value);
}

function getRecordClientKey(row) {
  return row.clientKey || row.client?._id || row.client?.id || row.clientData?.importMeta?.uniqueId || '';
}

export default function AnnualReturns() {
  const [currentUser, setCurrentUser] = useState(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [rows, setRows] = useState([]);
  const [query, setQuery] = useState('');
  const [expandedId, setExpandedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const [importNotice, setImportNotice] = useState('');
  const navigate = useNavigate();

  const filteredRows = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((row) => [
      row.clientName,
      row.annualYear,
      row.piboCategory,
      row.eprCategory,
      row.currentSpoc,
      row.previousSpoc,
      row.status
    ].join(' ').toLowerCase().includes(term));
  }, [query, rows]);

  const summary = useMemo(() => {
    const completed = rows.filter((row) => ['approved', 'completed', 'submitted'].includes(String(row.status || '').toLowerCase())).length;
    const draft = rows.filter((row) => String(row.status || 'draft').toLowerCase() === 'draft').length;
    const latestSaved = rows
      .map((row) => row.savedAt ? new Date(row.savedAt).getTime() : 0)
      .filter(Boolean)
      .sort((a, b) => b - a)[0];
    return {
      total: rows.length,
      visible: filteredRows.length,
      completed,
      draft,
      latestSaved: formatDisplayDate(latestSaved)
    };
  }, [filteredRows.length, rows]);

  useEffect(() => {
    loadPage();
  }, []);

  async function loadPage() {
    setLoading(true);
    setError('');
    try {
      const [meResponse, annualResponse] = await Promise.all([
        api.get(API_ENDPOINTS.auth.me),
        api.get(API_ENDPOINTS.annualReturns.list)
      ]);
      setCurrentUser(meResponse.data.user);
      setRows(annualResponse.data.annualReturns || []);
    } catch (err) {
      setError(err?.response?.data?.error || 'Unable to load annual returns.');
    } finally {
      setLoading(false);
    }
  }

  function handleLogout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('login_email');
    navigate('/', { replace: true });
  }

  function openProcessing(row) {
    const clientKey = getRecordClientKey(row);
    if (!clientKey || !row.annualYear) return;
    navigate(`/sales/client-data-processing/${encodeURIComponent(clientKey)}/${encodeURIComponent(row.annualYear)}`);
  }

  async function importClientYears(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || importing) return;
    setImporting(true);
    setError('');
    setImportNotice('');
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames?.[0]];
      if (!sheet) throw new Error('Excel file has no sheet');
      const excelRows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      const rows = excelRows.map((row, index) => ({
        row: index + 2,
        companyUniqueId: row['Company Unique ID'] || row['Unique ID'] || row['Lead Number'] || '',
        onboardingYear: row['Client Onboarding Year'] || row['Onboarding Year'] || '',
        firstAnnualReturnYear: row['First Annual Return Year Applicable'] || row['First Annual Return Year'] || ''
      })).filter((row) => String(row.companyUniqueId).trim());
      if (!rows.length) throw new Error('No usable Annual Return year rows found');
      const response = await api.post(API_ENDPOINTS.clients.bulkUpdateYears, { rows });
      const failures = response.data?.failures || [];
      const skipped = Number(response.data?.skipped || 0);
      setImportNotice(`${response.data?.updated || 0} client year records updated${skipped ? `; ${skipped} placeholder-only rows safely skipped` : ''}${failures.length ? `; ${failures.length} failed. First: row ${failures[0].row} (${failures[0].error})` : '.'}`);
      await loadPage();
    } catch (err) {
      const failures = err?.response?.data?.failures || [];
      setError(failures.length ? `${failures.length} rows failed. First: row ${failures[0].row} (${failures[0].error})` : err?.response?.data?.error || err.message || 'Unable to import Annual Return years.');
    } finally {
      setImporting(false);
    }
  }

  return (
    <DashboardShell currentUser={currentUser} onOpenProfile={() => setProfileOpen(true)} onLogout={handleLogout}>
      <div className="annual-list-page px-4 py-5 sm:px-6 lg:px-8">
        <section className="annual-list-hero">
          <div className="annual-list-hero-copy">
            <button type="button" onClick={() => navigate('/dashboard')} className="btn-lift annual-list-back" title="Back">
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <p className="annual-list-eyebrow">Annual Return Command Center</p>
              <h1>Annual Returns</h1>
              <p className="annual-list-subtitle">Track filing years, SPOC ownership, saved drafts, and processing status in one focused workspace.</p>
            </div>
          </div>
          <div className="annual-list-actions">
            <label className="btn-lift annual-list-refresh cursor-pointer">
              <Upload className="h-4 w-4" /> {importing ? 'Importing...' : 'Import Client Years'}
              <input type="file" accept=".xlsx,.xls" className="hidden" disabled={importing} onChange={importClientYears} />
            </label>
            <label className="annual-list-search">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-teal-700" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search annual returns..." />
            </label>
            <button type="button" onClick={loadPage} className="btn-lift annual-list-refresh">
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
          </div>
        </section>

        <section className="annual-list-stats">
          <AnnualReturnStat icon={FileText} label="Total Returns" value={summary.total} note={`${summary.visible} visible now`} />
          <AnnualReturnStat icon={CheckCircle2} label="Completed" value={summary.completed} note="Submitted / approved" tone="green" />
          <AnnualReturnStat icon={Clock3} label="Draft" value={summary.draft} note="Needs follow-up" tone="orange" />
          <AnnualReturnStat icon={BarChart3} label="Latest Saved" value={summary.latestSaved} note="Most recent activity" tone="blue" />
        </section>

        {error && <div className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 font-bold text-red-700">{error}</div>}
        {importNotice && <div className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 font-bold text-emerald-800">{importNotice}</div>}

        <section className="annual-list-table-card mt-5">
          <div className="hidden-scrollbar max-h-[650px] overflow-auto">
            <table className="annual-list-table w-full min-w-[1320px] text-left text-sm">
              <thead className="sticky top-0 z-20 text-xs font-black uppercase tracking-[0.06em] shadow-sm">
                <tr>
                  {['Client Name', 'Annual Year', 'PIBO Category', 'Service Category', 'Current SPOC', 'Previous SPOC', 'Status', 'Saved At', 'Actions'].map((header) => (
                    <th key={header} className="border-r border-slate-100 px-4 py-4 last:border-r-0">{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {loading ? (
                  <tr><td colSpan={9} className="px-5 py-14 text-center font-black text-slate-400">Loading annual returns...</td></tr>
                ) : filteredRows.length === 0 ? (
                  <tr><td colSpan={9} className="px-5 py-14 text-center font-black text-slate-400">No annual return data found.</td></tr>
                ) : filteredRows.map((row) => {
                  const rowId = row._id || `${row.clientKey}-${row.annualYear}`;
                  return (
                    <React.Fragment key={rowId}>
                      <tr className="annual-list-row align-top">
                        <td className="px-4 py-4 font-black text-slate-950">{display(row.clientName)}</td>
                        <td className="px-4 py-4 font-black text-slate-700"><span className="inline-flex items-center gap-2"><CalendarDays className="h-4 w-4 text-emerald-700" />{display(row.annualYear)}</span></td>
                        <td className="px-4 py-4 font-bold text-slate-600">{display(row.piboCategory)}</td>
                        <td className="px-4 py-4 font-bold text-slate-600">{display(row.eprCategory)}</td>
                        <td className="px-4 py-4 font-bold text-slate-700">{display(row.currentSpoc)}</td>
                        <td className="px-4 py-4 font-bold text-slate-700">{display(row.previousSpoc)}</td>
                        <td className="px-4 py-4"><span className="annual-list-status">{display(row.status, 'draft')}</span></td>
                        <td className="px-4 py-4 font-bold text-slate-600">{row.savedAt ? new Date(row.savedAt).toLocaleString('en-IN') : '-'}</td>
                        <td className="px-4 py-4">
                          <div className="flex gap-2">
                            <button type="button" onClick={() => openProcessing(row)} className="btn-lift annual-list-open">
                              <Eye className="h-4 w-4" /> Open
                            </button>
                            <button type="button" onClick={() => setExpandedId((current) => current === rowId ? '' : rowId)} className="btn-lift annual-list-expand">
                              <ChevronDown className={`h-4 w-4 transition ${expandedId === rowId ? 'rotate-180' : ''}`} />
                            </button>
                          </div>
                        </td>
                      </tr>
                      {expandedId === rowId && (
                        <tr>
                          <td colSpan={9} className="annual-list-expanded px-4 py-4">
                            <pre className="max-h-80 overflow-auto rounded-lg border border-slate-200 bg-white p-4 text-xs font-bold leading-6 text-slate-700">{JSON.stringify(row.draft || row, null, 2)}</pre>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      {profileOpen && <ProfileModal user={currentUser} saving={false} onClose={() => setProfileOpen(false)} onLogout={handleLogout} onSave={() => {}} onUpdatePassword={() => {}} />}
    </DashboardShell>
  );
}

function AnnualReturnStat({ icon: Icon, label, value, note, tone = 'teal' }) {
  const numeric = typeof value === 'number' && Number.isFinite(value);
  const animatedValue = useCountUp(numeric ? value : 0, numeric);
  return (
    <div className={`annual-list-stat annual-list-stat-${tone}`}>
      <span className="annual-list-stat-icon"><Icon className="h-5 w-5" /></span>
      <div>
        <p>{label}</p>
        <strong className={numeric ? 'count-up-number' : ''}>{numeric ? animatedValue : value}</strong>
        <small>{note}</small>
      </div>
    </div>
  );
}

function useCountUp(value, active = true, duration = 950) {
  const [displayValue, setDisplayValue] = useState(active ? 0 : value);

  useEffect(() => {
    if (!active) {
      setDisplayValue(value);
      return undefined;
    }

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
      setDisplayValue(value);
      return undefined;
    }

    const start = performance.now();
    const from = 0;
    const to = Number(value) || 0;
    let frameId;

    function tick(now) {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayValue(Math.round(from + (to - from) * eased));
      if (progress < 1) frameId = requestAnimationFrame(tick);
    }

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [active, duration, value]);

  return displayValue;
}
