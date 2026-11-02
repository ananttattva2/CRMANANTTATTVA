import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Building2, ChevronLeft, ChevronRight, Download, Eye, FileImage, FileText,
  Files, FolderOpen, Image as ImageIcon, LoaderCircle, Plus, Search, ShieldCheck,
  Sparkles, UploadCloud, X
} from 'lucide-react';
import DashboardShell from '../components/dashboard/DashboardShell';
import api, { readApiError } from '../services/api';
import { API_ENDPOINTS } from '../services/apiEndpoints';
import { uploadMedia } from '../services/mediaUpload';
import '../styles/documents-library.css';

const TABS = [
  { id: 'company', label: 'Company Documents', short: 'Company', icon: Building2, description: 'Profiles, presentations, certificates and shared company resources.' },
  { id: 'policy', label: 'Policy Documents', short: 'Policy', icon: ShieldCheck, description: 'Policies, SOPs, guidelines and controlled reference material.' }
];
const POLICY_CATEGORIES = ['Plastic Waste', 'E-Waste', 'Tyre Waste', 'Used Oil', 'Battery Waste'];

function readCurrentUser() {
  try { return JSON.parse(localStorage.getItem('user') || '{}'); } catch { return {}; }
}

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value));
}

function initials(value) {
  return String(value || 'CRM User').split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join('').toUpperCase();
}

function UploadModal({ activeType, onClose, onSaved }) {
  const [title, setTitle] = useState('');
  const [serviceCategory, setServiceCategory] = useState('');
  const [file, setFile] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileInput = useRef(null);
  const tab = TABS.find((item) => item.id === activeType);
  const needsCategory = activeType === 'policy';

  const chooseFile = (candidate) => {
    setError('');
    if (!candidate) return;
    const extensionTypes = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
    const inferredType = candidate.type || extensionTypes[candidate.name.split('.').pop()?.toLowerCase()] || '';
    const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowed.includes(inferredType)) return setError('Choose a PDF, JPG, PNG, WEBP or GIF file.');
    if (candidate.size > 25 * 1024 * 1024) return setError('The maximum file size is 25 MB.');
    setFile(candidate.type ? candidate : new File([candidate], candidate.name, { type: inferredType, lastModified: candidate.lastModified }));
    if (!title) setTitle(candidate.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '));
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!title.trim() || !file || (needsCategory && !serviceCategory)) {
      return setError(needsCategory ? 'Enter a title, choose a policy category and select a file.' : 'Enter a title and select a file.');
    }
    setBusy(true);
    setError('');
    try {
      const uploaded = await uploadMedia(file, `crm/documents/${activeType}`);
      const { data } = await api.post(API_ENDPOINTS.documents.create, {
        documentType: activeType,
        title: title.trim(),
        serviceCategory: needsCategory ? serviceCategory : 'Company Documents',
        originalName: file.name,
        mimeType: file.type,
        size: file.size,
        storageKey: uploaded.storageKey
      });
      onSaved(data.document);
    } catch (uploadError) {
      setError(readApiError(uploadError, 'The document could not be uploaded. Please retry.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="doc-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
      <section className="doc-modal doc-upload-modal" role="dialog" aria-modal="true" aria-labelledby="upload-document-title">
        <div className="doc-modal-head">
          <div className="doc-modal-symbol"><UploadCloud size={24} /></div>
          <div><span className="doc-eyebrow">SHARED LIBRARY</span><h2 id="upload-document-title">Upload {tab.short} Document</h2><p>{tab.description}</p></div>
          <button className="doc-icon-button" onClick={onClose} disabled={busy} aria-label="Close"><X size={19} /></button>
        </div>
        <form onSubmit={submit} className="doc-upload-form">
          <label className="doc-field"><span>Document title <b>*</b></span><input autoFocus value={title} maxLength={160} onChange={(event) => setTitle(event.target.value)} placeholder="Enter a clear document title" /></label>
          {needsCategory && <label className="doc-field"><span>Service Category <b>*</b></span><select value={serviceCategory} onChange={(event) => setServiceCategory(event.target.value)}><option value="">Select waste category</option>{POLICY_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}</select><small className="mt-1.5 block text-[10px] text-slate-500">Policies are organised by their applicable waste category.</small></label>}
          <div className="doc-field"><span>Upload image or PDF <b>*</b></span>
            <button type="button" className={`doc-drop-zone ${dragging ? 'is-dragging' : ''} ${file ? 'has-file' : ''}`}
              onClick={() => fileInput.current?.click()} onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); chooseFile(event.dataTransfer.files?.[0]); }}>
              <input ref={fileInput} hidden type="file" accept="application/pdf,image/jpeg,image/png,image/webp,image/gif" onChange={(event) => chooseFile(event.target.files?.[0])} />
              <span className="doc-drop-icon">{file?.type?.startsWith('image/') ? <FileImage /> : <UploadCloud />}</span>
              {file ? <><strong>{file.name}</strong><small>{formatBytes(file.size)} · Click to replace</small></> : <><strong>Drop your file here or browse</strong><small>PDF, JPG, PNG, WEBP or GIF · Maximum 25 MB</small></>}
            </button>
          </div>
          {error && <div className="doc-form-error" role="alert">{error}</div>}
          <div className="doc-modal-actions"><button type="button" className="doc-button secondary" onClick={onClose} disabled={busy}>Cancel</button><button className="doc-button primary" disabled={busy}>{busy ? <><LoaderCircle className="spin" size={17} /> Uploading securely…</> : <><UploadCloud size={17} /> Upload Document</>}</button></div>
        </form>
      </section>
    </div>
  );
}

function PreviewModal({ document, onClose }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let objectUrl = '';
    let active = true;
    api.get(API_ENDPOINTS.documents.file(document.id), { responseType: 'blob' }).then(({ data }) => {
      if (!active) return;
      objectUrl = URL.createObjectURL(data);
      setUrl(objectUrl);
    }).catch((requestError) => active && setError(readApiError(requestError, 'Preview could not be loaded.')));
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [document.id]);

  const download = async () => {
    setDownloading(true);
    try {
      const { data } = await api.get(`${API_ENDPOINTS.documents.file(document.id)}?download=true`, { responseType: 'blob' });
      const downloadUrl = URL.createObjectURL(data);
      const anchor = window.document.createElement('a');
      anchor.href = downloadUrl; anchor.download = document.originalName; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
    } finally { setDownloading(false); }
  };

  return (
    <div className="doc-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="doc-modal doc-preview-modal" role="dialog" aria-modal="true" aria-labelledby="preview-document-title">
        <div className="doc-preview-head"><div>{document.documentType === 'policy' && <span className="doc-category-pill">{document.serviceCategory}</span>}<h2 id="preview-document-title">{document.title}</h2><p>{document.originalName} · {formatBytes(document.size)}</p></div><div className="doc-preview-actions"><button className="doc-button secondary" onClick={download} disabled={downloading}>{downloading ? <LoaderCircle className="spin" size={17} /> : <Download size={17} />} Download</button><button className="doc-icon-button" onClick={onClose} aria-label="Close"><X size={19} /></button></div></div>
        <div className="doc-preview-stage">
          {!url && !error && <div className="doc-preview-loading"><LoaderCircle className="spin" /><span>Preparing secure preview…</span></div>}
          {error && <div className="doc-preview-loading error"><FileText /><span>{error}</span></div>}
          {url && document.mimeType.startsWith('image/') && <img src={url} alt={document.title} />}
          {url && document.mimeType === 'application/pdf' && <iframe title={document.title} src={url} />}
        </div>
      </section>
    </div>
  );
}

export default function DocumentsLibrary() {
  const [currentUser] = useState(readCurrentUser);
  const [activeType, setActiveType] = useState('company');
  const [documents, setDocuments] = useState([]);
  const [collections, setCollections] = useState([]);
  const [totals, setTotals] = useState({ company: 0, policy: 0 });
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [preview, setPreview] = useState(null);
  const [notice, setNotice] = useState('');

  useEffect(() => { const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300); return () => clearTimeout(timer); }, [search]);

  const loadDocuments = useCallback(async (signal) => {
    setLoading(true); setError('');
    try {
      const { data } = await api.get(API_ENDPOINTS.documents.list, { signal, params: { type: activeType, category, search: debouncedSearch, page: pagination.page, limit: 18 } });
      setDocuments(data.documents || []); setCollections(data.collections || []); setTotals(data.totals || { company: 0, policy: 0 }); setPagination((value) => ({ ...value, ...(data.pagination || {}) }));
    } catch (requestError) {
      if (requestError.code !== 'ERR_CANCELED') setError(readApiError(requestError, 'Documents could not be loaded.'));
    } finally { if (!signal?.aborted) setLoading(false); }
  }, [activeType, category, debouncedSearch, pagination.page]);

  useEffect(() => { const controller = new AbortController(); loadDocuments(controller.signal); return () => controller.abort(); }, [loadDocuments]);
  useEffect(() => { setPagination((value) => ({ ...value, page: 1 })); }, [activeType, category, debouncedSearch]);
  useEffect(() => { if (!notice) return undefined; const timer = setTimeout(() => setNotice(''), 3500); return () => clearTimeout(timer); }, [notice]);

  const activeTab = useMemo(() => TABS.find((item) => item.id === activeType), [activeType]);
  const ActiveIcon = activeTab.icon;
  const selectTab = (id) => { setActiveType(id); setCategory(''); setSearch(''); setPagination((value) => ({ ...value, page: 1 })); };
  const saved = () => { setUploadOpen(false); setCategory(''); setPagination((value) => ({ ...value, page: 1 })); setNotice('Document uploaded and shared with all CRM users.'); loadDocuments(); };

  return (
    <DashboardShell currentUser={currentUser}>
      <div className="documents-page">
        <header className="documents-hero">
          <div className="documents-title-wrap"><span className="documents-hero-icon"><Files /></span><div><span className="doc-eyebrow">COMMUNICATION &amp; PLANNING</span><h1>Documents</h1><p>A secure, shared source for company resources and policy documents.</p></div></div>
          <button className="doc-button primary hero-upload" onClick={() => setUploadOpen(true)}><Plus size={18} /> Upload Document</button>
          <div className="documents-hero-decoration"><Sparkles /></div>
        </header>

        <section className="documents-tab-shell">
          <div className="documents-tabs" role="tablist" aria-label="Document type">
            {TABS.map((tab) => { const Icon = tab.icon; const selected = activeType === tab.id; return <button key={tab.id} role="tab" aria-selected={selected} className={selected ? 'active' : ''} onClick={() => selectTab(tab.id)}><span><Icon size={19} /></span><div><strong>{tab.label}</strong><small>{tab.description}</small></div><b>{totals[tab.id] || 0}</b></button>; })}
          </div>
          <div className="documents-toolbar"><div className="documents-section-title"><span><ActiveIcon size={19} /></span><div><h2>{activeTab.label}</h2><p>{pagination.total} document{pagination.total === 1 ? '' : 's'} in this view</p></div></div><label className="documents-search"><Search size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={activeType === 'policy' ? 'Search title, category or uploader…' : 'Search title, file or uploader…'} />{search && <button onClick={() => setSearch('')} aria-label="Clear search"><X size={15} /></button>}</label></div>
        </section>

        {activeType === 'policy' && !!collections.length && <section className="document-collections" aria-label="Policy category collections"><div className="document-collections-heading"><div><span className="doc-eyebrow">BROWSE COLLECTIONS</span><h2>Waste Categories</h2></div>{category && <button onClick={() => setCategory('')}>View all documents <X size={14} /></button>}</div><div className="collection-strip"><button className={`collection-card all ${!category ? 'active' : ''}`} onClick={() => setCategory('')}><span><FolderOpen /></span><div><strong>All Categories</strong><small>Complete policy library</small></div><b>{collections.reduce((sum, item) => sum + item.count, 0)}</b></button>{collections.map((item, index) => <button key={item.serviceCategory} style={{ '--delay': `${Math.min(index, 8) * 35}ms` }} className={`collection-card ${category === item.serviceCategory ? 'active' : ''}`} onClick={() => setCategory(item.serviceCategory)}><span><FolderOpen /></span><div><strong>{item.serviceCategory}</strong><small>Updated {formatDate(item.latestAt)}</small></div><b>{item.count}</b></button>)}</div></section>}

        <section className="documents-content">
          <div className="documents-content-head"><div><span className="doc-eyebrow">{category ? 'SELECTED COLLECTION' : 'LATEST DOCUMENTS'}</span><h2>{category || activeTab.label}</h2></div><span>{pagination.total} result{pagination.total === 1 ? '' : 's'}</span></div>
          {error && <div className="documents-state error"><FileText /><h3>Unable to load documents</h3><p>{error}</p><button className="doc-button secondary" onClick={() => loadDocuments()}>Retry</button></div>}
          {loading && !error && <div className="document-grid">{Array.from({ length: 6 }).map((_, index) => <div className="document-card skeleton" key={index}><div /><div /><div /></div>)}</div>}
          {!loading && !error && !documents.length && <div className="documents-state"><span><FolderOpen /></span><h3>No documents found</h3><p>{debouncedSearch || category ? 'Try a different search or service category.' : `Upload the first ${activeTab.short.toLowerCase()} document to start this shared library.`}</p>{!debouncedSearch && !category && <button className="doc-button primary" onClick={() => setUploadOpen(true)}><Plus size={17} /> Upload Document</button>}</div>}
          {!loading && !error && !!documents.length && <div className="document-grid">{documents.map((document, index) => { const isImage = document.mimeType.startsWith('image/'); return <article className="document-card" key={document.id} style={{ '--delay': `${Math.min(index, 12) * 35}ms` }}><button className={`document-visual ${isImage ? 'image' : 'pdf'}`} onClick={() => setPreview(document)} aria-label={`Preview ${document.title}`}><span>{isImage ? <ImageIcon /> : <FileText />}</span><small>{isImage ? 'IMAGE' : 'PDF'}</small><i><Eye size={17} /> Preview</i></button><div className="document-card-body">{document.documentType === 'policy' && <span className="doc-category-pill">{document.serviceCategory}</span>}<h3 title={document.title}>{document.title}</h3><p title={document.originalName}>{document.originalName}</p><div className="document-meta"><span className="document-avatar">{initials(document.uploadedByName)}</span><div><strong>{document.uploadedByName}</strong><small>{formatDate(document.createdAt)} · {formatBytes(document.size)}</small></div></div></div><button className="document-view-button" onClick={() => setPreview(document)}><Eye size={16} /> View Document</button></article>; })}</div>}
          {pagination.pages > 1 && <nav className="documents-pagination" aria-label="Document pages"><button disabled={pagination.page <= 1} onClick={() => setPagination((value) => ({ ...value, page: value.page - 1 }))}><ChevronLeft /></button><span>Page <b>{pagination.page}</b> of {pagination.pages}</span><button disabled={pagination.page >= pagination.pages} onClick={() => setPagination((value) => ({ ...value, page: value.page + 1 }))}><ChevronRight /></button></nav>}
        </section>
      </div>
      {uploadOpen && <UploadModal activeType={activeType} onClose={() => setUploadOpen(false)} onSaved={saved} />}
      {preview && <PreviewModal document={preview} onClose={() => setPreview(null)} />}
      {notice && <div className="documents-toast"><ShieldCheck size={18} /> {notice}</div>}
    </DashboardShell>
  );
}
