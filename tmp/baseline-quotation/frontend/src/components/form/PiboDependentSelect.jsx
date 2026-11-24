import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, CheckCircle2, ChevronDown, Loader2, Plus, Search, X } from 'lucide-react';
import { PIBO_PARENTS, normalizePiboCategories } from '../../constants/piboCategories';

const ADD_NEW_VALUE = '__add_new_category__';

function PopupSelect({ value = '', options = [], placeholder = 'Select option', disabled = false, onChange, onAddNew, compact = false }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [menuPosition, setMenuPosition] = useState(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  const selected = options.find((option) => String(option.value) === String(value));
  const filteredOptions = useMemo(
    () => options.filter((option) => option.label.toLowerCase().includes(search.trim().toLowerCase())),
    [options, search]
  );

  function positionMenu() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.max(rect.width, compact ? 260 : 320);
    const left = Math.min(rect.left, window.innerWidth - width - 12);
    setMenuPosition({ left: Math.max(12, left), top: rect.bottom + 7, width });
  }

  useEffect(() => {
    if (!open) return undefined;
    positionMenu();
    function closeOnOutside(event) {
      if (!triggerRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) setOpen(false);
    }
    function reposition() { positionMenu(); }
    document.addEventListener('mousedown', closeOnOutside);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      document.removeEventListener('mousedown', closeOnOutside);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open]);

  function choose(nextValue) {
    onChange(nextValue);
    setOpen(false);
    setSearch('');
  }

  const triggerClass = compact
    ? `flex h-10 w-full min-w-44 items-center justify-between rounded-lg border border-slate-300 bg-white px-3 text-xs font-black text-slate-800 outline-none transition ${disabled ? 'cursor-not-allowed opacity-60' : 'hover:border-emerald-400 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100'}`
    : `flex min-h-12 w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-800 outline-none transition ${disabled ? 'cursor-not-allowed opacity-60' : 'hover:border-emerald-400 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100'}`;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        className={triggerClass}
        onClick={() => !disabled && setOpen((current) => !current)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={`truncate text-left ${selected ? 'text-slate-800' : 'text-slate-400'}`}>{selected?.label || placeholder}</span>
        <ChevronDown className="ml-3 h-4 w-4 shrink-0 text-slate-500" />
      </button>
      {open && menuPosition && createPortal(
        <div ref={menuRef} className="z-[10000] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/15" style={{ position: 'fixed', ...menuPosition }}>
          <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
            <Search className="h-4 w-4 text-slate-400" />
            <input
              autoFocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search..."
              className="w-full bg-transparent text-sm font-bold text-slate-700 outline-none"
            />
            {search && <button type="button" onClick={() => setSearch('')} className="text-slate-400"><X className="h-4 w-4" /></button>}
          </div>
          <div className="max-h-64 overflow-auto py-1" role="listbox">
            {filteredOptions.length ? filteredOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={String(option.value) === String(value)}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-bold text-slate-700 hover:bg-emerald-50"
                onClick={() => choose(option.value)}
              >
                <span>{option.label}</span>
                {String(option.value) === String(value) && <Check className="h-4 w-4 text-emerald-600" />}
              </button>
            )) : <div className="px-3 py-3 text-sm font-bold text-slate-400">No matching option</div>}
          </div>
          {onAddNew && <button type="button" className="flex w-full items-center gap-2 border-t border-slate-100 px-3 py-3 text-left text-sm font-black text-emerald-700 hover:bg-emerald-50" onClick={() => { setOpen(false); setSearch(''); onAddNew(); }}><Plus className="h-4 w-4" />Add New Category</button>}
        </div>,
        document.body
      )}
    </>
  );
}

export default function PiboDependentSelect({ parent = '', value = '', categories = [], loading = false, onChange, onAddCategory, required = false, compact = false }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const childOptions = normalizePiboCategories(categories).filter((category) => category.parent === parent);

  function changeParent(nextParent) {
    onChange(nextParent, '');
    setSuccess('');
    setError('');
  }

  function changeChild(nextValue) {
    if (nextValue === ADD_NEW_VALUE) {
      if (!parent) {
    setError('Select Applicant Type before adding a category.');
        return;
      }
      setAdding(true);
      setName('');
      setError('');
      return;
    }
    onChange(parent, nextValue);
  }

  async function submitNewCategory(event) {
    event.preventDefault();
    const trimmed = name.trim().replace(/\s+/g, ' ');
    if (!parent) return setError('Select Applicant Type first.');
    if (!trimmed) return setError('Enter a category name.');
    if (trimmed.length > 60) return setError('Category name must be 60 characters or fewer.');
    if (childOptions.some((category) => category.name.toLowerCase() === trimmed.toLowerCase())) return setError(`This category already exists under ${parent}.`);
    setSaving(true);
    setError('');
    try {
      const category = await onAddCategory(parent, trimmed);
      onChange(category.parent, category.name);
      setSuccess(`${category.name} added under ${category.parent}.`);
      setAdding(false);
      setName('');
    } catch (requestError) {
      setError(requestError?.response?.data?.error || requestError?.message || 'Unable to add category.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={`grid ${compact ? 'gap-2' : 'gap-4 sm:grid-cols-2'}`}>
      <label className="grid gap-2">
        <span className={`${compact ? 'text-[10px]' : 'text-xs'} font-black text-slate-700`}>Applicant Type{required && <b className="text-red-500"> *</b>}</span>
        <PopupSelect
          value={parent}
          options={PIBO_PARENTS.map((option) => ({ value: option, label: option }))}
          placeholder="Select PIBO / SIMP / PWP"
          onChange={changeParent}
          compact={compact}
        />
      </label>
      {parent && (
        <label className="grid gap-2">
          <span className={`${compact ? 'text-[10px]' : 'text-xs'} font-black text-slate-700`}>{parent} Category{required && <b className="text-red-500"> *</b>}</span>
          <PopupSelect
            value={value}
            options={childOptions.map((category) => ({ value: category.name, label: category.name }))}
            placeholder={loading ? 'Loading categories…' : `Select ${parent} category`}
            disabled={loading}
            onChange={changeChild}
            onAddNew={onAddCategory ? () => changeChild(ADD_NEW_VALUE) : undefined}
            compact={compact}
          />
        </label>
      )}
      {success && <p className={`flex items-center gap-2 text-xs font-bold text-emerald-700 ${compact ? '' : 'sm:col-span-2'}`}><CheckCircle2 className="h-4 w-4" />{success}</p>}
      {error && !adding && <p className={`text-xs font-bold text-red-600 ${compact ? '' : 'sm:col-span-2'}`}>{error}</p>}
      {adding && createPortal(
        <div className="fixed inset-0 z-[10000] grid place-items-center bg-slate-950/45 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setAdding(false); }}>
          <form onSubmit={submitNewCategory} className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-widest text-emerald-700">{parent} category</p><h3 className="mt-1 text-xl font-black text-slate-950">Add New Category</h3></div><button type="button" disabled={saving} onClick={() => setAdding(false)} className="grid h-9 w-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button></div>
            <label className="mt-5 grid gap-2"><span className="text-xs font-black text-slate-700">Category name</span><input autoFocus maxLength={60} value={name} onChange={(event) => setName(event.target.value)} className="min-h-12 rounded-xl border border-slate-200 px-4 text-sm font-black outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100" placeholder={`New ${parent} category`} /></label>
            <p className="mt-2 text-right text-xs font-bold text-slate-400">{name.trim().length}/60</p>
            {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-600">{error}</p>}
            <div className="mt-6 flex justify-end gap-3"><button type="button" disabled={saving} onClick={() => setAdding(false)} className="min-h-11 rounded-xl border border-slate-200 px-5 text-sm font-black text-slate-700">Cancel</button><button type="submit" disabled={saving} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-600 px-5 text-sm font-black text-white disabled:opacity-60">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}{saving ? 'Saving…' : 'Add Category'}</button></div>
          </form>
        </div>, document.body
      )}
    </div>
  );
}
