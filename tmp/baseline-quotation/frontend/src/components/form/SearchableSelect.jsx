import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Plus, Search, X } from 'lucide-react';

export default function SearchableSelect({
  value = '', options = [], onChange, disabled = false,
  placeholder = 'Select or type to create new', allowCustom = true,
  canAddCustom = false, addLabel = 'option', onAddCustom, multiple = false,
  remoteSearch = false, onSearchQuery, loading = false,
  minimumSearchCharacters = 0, loadingMessage = 'Searching...',
  noResultsMessage = 'No matching option', promptMessage = 'Start typing to search'
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [position, setPosition] = useState(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const normalized = useMemo(() => {
    const uniqueOptions = new Map();
    options
      .map((option) => typeof option === 'string' ? ({ value: option, label: option }) : option)
      .filter((option) => option?.value)
      .forEach((option) => {
        const key = String(option.value);
        if (!uniqueOptions.has(key)) uniqueOptions.set(key, option);
      });
    return [...uniqueOptions.values()];
  }, [options]);
  const selectedValues = multiple ? String(value || '').split(',').map((item) => item.trim()).filter(Boolean) : [String(value || '')].filter(Boolean);
  const selectedOption = normalized.find((option) => String(option.value) === String(value));
  const selectedLabels = selectedValues.map((selectedValue) => normalized.find((option) => String(option.value) === selectedValue)?.label || selectedValue);
  const filtered = remoteSearch ? normalized : normalized.filter((option) => `${option.label} ${option.value}`.toLowerCase().includes(query.trim().toLowerCase()));
  const cleanQuery = query.trim();
  const belowMinimum = remoteSearch && cleanQuery.length < minimumSearchCharacters;
  const exactMatch = normalized.some((option) => String(option.label || option.value).trim().toLowerCase() === cleanQuery.toLowerCase());

  function positionMenu() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const spaceBelow = window.innerHeight - rect.bottom;
    const height = Math.min(310, Math.max(170, filtered.length * 44 + 70));
    const menuWidth = Math.min(Math.max(rect.width, 340), window.innerWidth - 24);
    setPosition({
      left: Math.max(12, Math.min(rect.left, window.innerWidth - menuWidth - 12)),
      top: spaceBelow >= height + 10 ? rect.bottom + 7 : Math.max(12, rect.top - height - 7),
      width: menuWidth,
      maxHeight: height
    });
  }

  useEffect(() => {
    if (!open) return undefined;
    positionMenu();
    const close = (event) => {
      if (!triggerRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) setOpen(false);
    };
    const reposition = () => positionMenu();
    document.addEventListener('mousedown', close);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open, filtered.length]);

  function choose(option) {
    if (multiple) {
      const optionValue = String(option.value);
      const next = selectedValues.includes(optionValue) ? selectedValues.filter((item) => item !== optionValue) : [...selectedValues, optionValue];
      onChange(next.join(', '));
      setQuery('');
      return;
    }
    onChange(option.value);
    setQuery('');
    setOpen(false);
  }

  const statusText = loading ? loadingMessage : (belowMinimum ? promptMessage : (query ? `Results for “${query}”` : promptMessage));

  return (
    <>
      <div ref={triggerRef} className={`relative flex min-h-12 items-center rounded-xl border bg-white transition ${open ? 'border-emerald-500 ring-4 ring-emerald-100' : 'border-slate-200 hover:border-emerald-300'} ${disabled ? 'cursor-not-allowed bg-slate-100 opacity-70' : ''}`}>
        <input value={open ? query : (multiple ? selectedLabels.join(', ') : (selectedOption?.label || value))} disabled={disabled} onFocus={() => { setQuery(''); onSearchQuery?.(''); setOpen(true); }} onChange={(event) => { const nextQuery = event.target.value; setQuery(nextQuery); onSearchQuery?.(nextQuery); if (!remoteSearch && !multiple && allowCustom && !canAddCustom) onChange(nextQuery); setOpen(true); }} placeholder={placeholder} className="min-w-0 flex-1 bg-transparent px-4 py-3 text-sm font-black text-slate-800 outline-none placeholder:text-slate-400" />
        {(value || query) && !disabled && <button type="button" onClick={() => { onChange(''); setQuery(''); onSearchQuery?.(''); }} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Clear"><X className="h-4 w-4" /></button>}
        <button type="button" disabled={disabled} onClick={() => { setQuery(''); onSearchQuery?.(''); setOpen((current) => !current); }} className="mr-2 grid h-8 w-8 place-items-center rounded-lg text-emerald-700 hover:bg-emerald-50" aria-label="Toggle options"><ChevronDown className={`h-4 w-4 transition ${open ? 'rotate-180' : ''}`} /></button>
      </div>
      {open && position && createPortal(
        <div ref={menuRef} style={position} className="fixed z-[10010] flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl shadow-slate-900/20">
          <div className="flex shrink-0 items-center gap-2 border-b border-slate-100 px-3 py-2 text-slate-400"><Search className="h-4 w-4" /><span className="truncate text-xs font-bold">{statusText}</span></div>
          <div className="mt-1 min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
            {!loading && !belowMinimum && filtered.map((option) => { const isSelected = multiple ? selectedValues.includes(String(option.value)) : String(option.value) === String(value); return <button key={option.value} type="button" onClick={() => choose(option)} title={option.label} className={`flex w-full items-start justify-between gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-bold transition ${isSelected ? 'bg-emerald-50 text-emerald-800' : 'text-slate-700 hover:bg-slate-50 hover:text-slate-950'}`}><span className="min-w-0 whitespace-normal break-words leading-5">{option.label}</span>{isSelected && <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />}</button>})}
            {(loading || belowMinimum || (!filtered.length && !loading)) && <div className="px-4 py-7 text-center"><p className="text-sm font-black text-slate-600">{loading ? loadingMessage : (belowMinimum ? promptMessage : noResultsMessage)}</p><p className="mt-1 text-xs font-bold text-slate-400">{belowMinimum ? `Enter at least ${minimumSearchCharacters} characters.` : (!loading && !filtered.length ? 'Try another search.' : '')}</p></div>}
          </div>
          {canAddCustom && cleanQuery && !exactMatch && <button type="button" onClick={async () => { const added = await onAddCustom?.(cleanQuery); if (added !== false) { onChange(cleanQuery); setQuery(''); setOpen(false); } }} className="mt-2 flex shrink-0 items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-700 transition hover:bg-emerald-100"><Plus className="h-4 w-4" />Add {addLabel}: “{cleanQuery}”</button>}
        </div>, document.body
      )}
    </>
  );
}
