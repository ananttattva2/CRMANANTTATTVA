import React, { useEffect, useRef, useState } from 'react';
import { ExternalLink, Eye, FileText, Upload, X } from 'lucide-react';
import { isEmailProof } from './OutlookMsgViewer';
import { droppedProofFiles, isNativeProofDrop } from './droppedProofFiles.mjs';

const ACCEPTED = 'image/*,.pdf,.eml,.msg,application/pdf,message/rfc822,application/vnd.ms-outlook';
const STANDARD_MAX_BYTES = 15 * 1024 * 1024;
const EMAIL_MAX_BYTES = 100 * 1024 * 1024;
const isEmailFile = (file) => /\.(eml|msg)$/i.test(file?.name || '') || ['message/rfc822', 'application/vnd.ms-outlook'].includes(String(file?.type || '').toLowerCase());

export default function PurchaseProofDropzone({ files = [], required, disabled, busy, onUpload, onRemove, onPreview, onError }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [fileError, setFileError] = useState('');
  const [readingDrop, setReadingDrop] = useState(false);
  const dropSequence = useRef(0);
  const nativeDrop = useRef(null);
  const completedDrop = useRef(null);
  const mounted = useRef(true);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; dropSequence.current++; }; }, []);

  useEffect(() => {
    const preventFileNavigation = (event) => {
      if (Array.from(event.dataTransfer?.types || []).includes('Files')) {
        event.preventDefault();
      }
    };

    window.addEventListener('dragover', preventFileNavigation);
    window.addEventListener('drop', preventFileNavigation);
    return () => {
      window.removeEventListener('dragover', preventFileNavigation);
      window.removeEventListener('drop', preventFileNavigation);
    };
  }, []);

  const acceptFiles = (fileList) => {
    const selected = Array.from(fileList || []);
    if (!selected.length) {
      const message = 'Outlook did not share the email file with this browser. Save or drag the email to your Desktop as .eml or .msg, then choose or drop that saved file here. This is not a CRM account permission error.';
      setFileError(message); onError?.(message); return;
    }
    setFileError('');
    const empty = selected.find(file => !file.size);
    if (empty) {
      const message = isEmailFile(empty)
        ? `${empty.name || 'Email file'} is empty or Outlook has not finished preparing it. Save the email as .eml or .msg and choose the saved file.`
        : `${empty.name || 'File'} is empty. Choose the original non-empty file.`;
      setFileError(message); onError?.(message); return;
    }
    const invalid = selected.find((file) => !file.type.startsWith('image/') && !['application/pdf', 'application/vnd.ms-outlook', 'message/rfc822'].includes(file.type) && !/\.(pdf|eml|msg|png|jpe?g|gif|webp)$/i.test(file.name));
    if (invalid) {
      const message = `${invalid.name}: only images, PDF, EML and Outlook MSG files are supported.`;
      setFileError(message); onError?.(message); return;
    }
    const oversizedEmail = selected.find((file) => isEmailFile(file) && file.size > EMAIL_MAX_BYTES);
    if (oversizedEmail) {
      const message = `${oversizedEmail.name}: maximum Outlook/EML source size is 100 MB.`;
      setFileError(message); onError?.(message); return;
    }
    const tooLarge = selected.find((file) => !isEmailFile(file) && file.size > STANDARD_MAX_BYTES);
    if (tooLarge) {
      const message = `${tooLarge.name}: maximum image/PDF proof size is 15 MB.`;
      setFileError(message); onError?.(message); return;
    }
    if (typeof onUpload !== 'function') {
      const message = 'Upload is temporarily unavailable. Refresh the page and try again.';
      setFileError(message); onError?.(message); return;
    }
    onUpload(selected);
    return true;
  };

  const handleDragEnter = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!disabled && !busy) setDragging(true);
  };

  const handleDragOver = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = disabled || busy || readingDrop ? 'none' : 'copy';
  };

  const handleDragLeave = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false);
  };

  const handleDrop = async (event, allowNative = false) => {
    // A real file input can materialize Outlook virtual files through its
    // native change event. Do not cancel that default action on the input.
    allowNative = allowNative && isNativeProofDrop(event.dataTransfer);
    if (!allowNative) event.preventDefault();
    event.stopPropagation();
    setDragging(false);
    if (disabled) {
      event.preventDefault();
      const message = 'You do not have permission to upload proof for this client.';
      setFileError(message); onError?.(message); return;
    }
    if (busy || readingDrop) {
      event.preventDefault();
      const message = 'Please wait for the current upload to finish.';
      setFileError(message); onError?.(message); return;
    }
    const ticket = ++dropSequence.current;
    nativeDrop.current = allowNative ? ticket : null;
    setReadingDrop(true); setFileError('');
    // Start capture before yielding: Outlook's protected drag store is only
    // readable during this event, even when the file itself resolves later.
    try {
      const pending = droppedProofFiles(event.dataTransfer);
      const selected = await pending;
      if (allowNative && !selected.length) await new Promise(resolve => setTimeout(resolve, 1500));
      if (!mounted.current || ticket !== dropSequence.current || completedDrop.current === ticket) return;
      if (acceptFiles(selected)) completedDrop.current = ticket;
    } catch {
      if (mounted.current && ticket === dropSequence.current && completedDrop.current !== ticket) acceptFiles([]);
    } finally { if (mounted.current && ticket === dropSequence.current) setReadingDrop(false); }
  };

  const handleInputChange = event => {
    const selected = Array.from(event.target.files || []);
    event.target.value = '';
    if (disabled || busy || !selected.length) return;
    const ticket = nativeDrop.current;
    if (ticket !== null && completedDrop.current === ticket) return;
    if (ticket !== null && selected.every(file => !file.size)) return;
    setReadingDrop(false);
    if (acceptFiles(selected) && ticket !== null) completedDrop.current = ticket;
  };

  const missing = required && !files.length;
  return <div role="group" aria-label="Supporting document upload" aria-busy={Boolean(busy || readingDrop)} onDragEnter={handleDragEnter} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={event => handleDrop(event)} className={`min-w-0 rounded-xl border p-2.5 transition ${dragging ? 'border-emerald-500 bg-emerald-100/80 ring-2 ring-emerald-200' : missing ? 'border-amber-400 bg-amber-50' : files.length ? 'border-emerald-200 bg-emerald-50/70' : 'border-slate-200 bg-slate-50'}`}>
    {!disabled && <label className={`relative grid min-h-16 w-full cursor-pointer place-items-center rounded-lg border px-3 py-2 text-center transition focus-within:ring-2 focus-within:ring-emerald-400 ${dragging ? 'border-emerald-500 bg-emerald-100' : missing ? 'border-amber-300 bg-white' : 'border-emerald-300 bg-white hover:bg-emerald-50'}`}>
      <span className="pointer-events-none"><span className={`inline-flex items-center gap-2 text-sm font-black ${missing ? 'text-orange-700' : 'text-emerald-700'}`}><Upload className="h-4 w-4" />{busy ? 'Uploading…' : readingDrop ? 'Reading Outlook email…' : dragging ? 'Drop files to upload' : files.length ? 'Upload more files' : 'Upload proof now'}</span><span className="mt-1 block text-[10px] font-bold text-slate-500">Drag & drop images, PDF, EML or Outlook MSG here, or click to upload.</span></span>
      <input ref={inputRef} type="file" multiple accept={ACCEPTED} aria-label="Choose supporting documents" disabled={Boolean(busy)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-wait" onClick={() => { dropSequence.current++; nativeDrop.current = null; setReadingDrop(false); }} onDrop={event => handleDrop(event, true)} onChange={handleInputChange} />
    </label>}
    {fileError && <p role="alert" className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-black text-rose-700">{fileError}</p>}
    {fileError && !disabled && <button type="button" disabled={Boolean(busy || readingDrop)} onClick={() => { nativeDrop.current = null; inputRef.current?.click(); }} className="mt-2 rounded-lg border border-emerald-300 bg-white px-3 py-2 text-xs font-bold text-emerald-800 disabled:opacity-50">Choose saved email / file</button>}
    {missing && <p className="mt-2 text-xs font-black leading-5 text-orange-700">You selected Yes. Please upload proof to complete this row.</p>}
    {!!files.length && <p className="mt-2 text-xs font-black text-emerald-700">Proof uploaded for this Yes status.</p>}
    <div className="mt-2 space-y-2">{files.map((file, index) => {
      const url = file.secureUrl || file.url;
      const email = isEmailProof(file);
      return <div key={`${url}-${index}`} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-2"><FileText className="h-4 w-4 shrink-0 text-emerald-600" /><button type="button" onClick={() => email ? onPreview(file) : window.open(url, '_blank', 'noopener,noreferrer')} className="min-w-0 flex-1 truncate text-left text-xs font-black text-[#087A70] underline">{file.name || `Proof ${index + 1}`}</button>{email && <button type="button" title="Preview decoded email" onClick={() => onPreview(file)} className="rounded p-1 text-emerald-700 hover:bg-emerald-50"><Eye className="h-4 w-4" /></button>}{!email && <a href={url} target="_blank" rel="noreferrer" title="Open original" className="rounded p-1 text-slate-500 hover:bg-slate-100"><ExternalLink className="h-4 w-4" /></a>}{!disabled && <button type="button" onClick={() => onRemove(index, file)} className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1.5 text-[10px] font-black text-rose-600"><X className="h-3.5 w-3.5" /></button>}</div>;
    })}</div>
  </div>;
}
