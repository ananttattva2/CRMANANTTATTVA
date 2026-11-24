import React, { useEffect, useRef, useState } from 'react';
import { ExternalLink, Eye, FileText, Upload, X } from 'lucide-react';
import { isEmailProof } from './OutlookMsgViewer';

const ACCEPTED = 'image/*,.pdf,.eml,.msg,application/pdf,message/rfc822,application/vnd.ms-outlook';
const STANDARD_MAX_BYTES = 15 * 1024 * 1024;
const EMAIL_MAX_BYTES = 100 * 1024 * 1024;
const isEmailFile = (file) => /\.(eml|msg)$/i.test(file?.name || '') || ['message/rfc822', 'application/vnd.ms-outlook'].includes(String(file?.type || '').toLowerCase());

export default function PurchaseProofDropzone({ files = [], required, disabled, busy, onUpload, onRemove, onPreview, onError }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [fileError, setFileError] = useState('');

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
    if (!selected.length) return;
    setFileError('');
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
    onUpload(selected);
  };

  const handleDragEnter = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!disabled && !busy) setDragging(true);
  };

  const handleDragOver = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = disabled || busy ? 'none' : 'copy';
  };

  const handleDragLeave = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false);
  };

  const handleDrop = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setDragging(false);
    if (!disabled && !busy) acceptFiles(event.dataTransfer.files);
  };

  const missing = required && !files.length;
  return <div onDragEnter={handleDragEnter} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop} className={`min-w-0 rounded-xl border p-2.5 transition ${dragging ? 'border-emerald-500 bg-emerald-100/80 ring-2 ring-emerald-200' : missing ? 'border-amber-400 bg-amber-50' : files.length ? 'border-emerald-200 bg-emerald-50/70' : 'border-slate-200 bg-slate-50'}`}>
    {!disabled && <button type="button" disabled={busy} onClick={() => inputRef.current?.click()} className={`grid min-h-16 w-full place-items-center rounded-lg border px-3 py-2 text-center transition ${dragging ? 'border-emerald-500 bg-emerald-100' : missing ? 'border-amber-300 bg-white' : 'border-emerald-300 bg-white hover:bg-emerald-50'}`}>
      <span><span className={`inline-flex items-center gap-2 text-sm font-black ${missing ? 'text-orange-700' : 'text-emerald-700'}`}><Upload className="h-4 w-4" />{busy ? 'Uploading…' : dragging ? 'Drop files to upload' : files.length ? 'Upload more files' : 'Upload proof now'}</span><span className="mt-1 block text-[10px] font-bold text-slate-500">Drag & drop images, PDF, EML or Outlook MSG here, or click to upload.</span></span>
    </button>}
    <input ref={inputRef} type="file" multiple accept={ACCEPTED} className="hidden" onChange={(event) => { acceptFiles(event.target.files); event.target.value = ''; }} />
    {fileError && <p role="alert" className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-black text-rose-700">{fileError}</p>}
    {missing && <p className="mt-2 text-xs font-black leading-5 text-orange-700">You selected Yes. Please upload proof to complete this row.</p>}
    {!!files.length && <p className="mt-2 text-xs font-black text-emerald-700">Proof uploaded for this Yes status.</p>}
    <div className="mt-2 space-y-2">{files.map((file, index) => {
      const url = file.secureUrl || file.url;
      const email = isEmailProof(file);
      return <div key={`${url}-${index}`} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-2"><FileText className="h-4 w-4 shrink-0 text-emerald-600" /><button type="button" onClick={() => email ? onPreview(file) : window.open(url, '_blank', 'noopener,noreferrer')} className="min-w-0 flex-1 truncate text-left text-xs font-black text-[#087A70] underline">{file.name || `Proof ${index + 1}`}</button>{email && <button type="button" title="Preview decoded email" onClick={() => onPreview(file)} className="rounded p-1 text-emerald-700 hover:bg-emerald-50"><Eye className="h-4 w-4" /></button>}{!email && <a href={url} target="_blank" rel="noreferrer" title="Open original" className="rounded p-1 text-slate-500 hover:bg-slate-100"><ExternalLink className="h-4 w-4" /></a>}{!disabled && <button type="button" onClick={() => onRemove(index, file)} className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1.5 text-[10px] font-black text-rose-600"><X className="h-3.5 w-3.5" /></button>}</div>;
    })}</div>
  </div>;
}
