import React, { useEffect, useMemo } from 'react'
import { ArrowLeft, Download, FileText } from 'lucide-react'

function readDocument() {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const url = String(params.get('url') || '').trim()
  return {
    url: /^(https?:|data:|blob:)/i.test(url) ? url : '',
    name: String(params.get('name') || 'Document').trim() || 'Document'
  }
}

export default function DocumentViewer() {
  const document = useMemo(readDocument, [])
  useEffect(() => {
    const previous = window.document.title
    window.document.title = `${document.name} - Document Viewer`
    return () => { window.document.title = previous }
  }, [document.name])

  if (!document.url) {
    return <main className="grid min-h-screen place-items-center bg-slate-100 p-6"><section className="max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-xl"><FileText className="mx-auto h-10 w-10 text-slate-400" /><h1 className="mt-4 text-xl font-black text-slate-900">Document unavailable</h1><p className="mt-2 text-sm text-slate-500">The document link is missing or invalid.</p><button type="button" onClick={() => window.close()} className="mt-6 rounded-xl bg-teal-700 px-5 py-3 text-sm font-black text-white">Close tab</button></section></main>
  }

  return <main className="flex h-screen min-h-0 flex-col bg-slate-900"><header className="flex shrink-0 items-center justify-between gap-4 border-b border-white/10 bg-slate-950 px-4 py-3 text-white sm:px-6"><div className="flex min-w-0 items-center gap-3"><button type="button" onClick={() => window.close()} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/15 bg-white/5 hover:bg-white/10" aria-label="Close document tab"><ArrowLeft className="h-5 w-5" /></button><div className="min-w-0"><p className="text-[10px] font-black uppercase tracking-[0.18em] text-teal-300">Full document</p><h1 className="truncate text-sm font-black sm:text-base">{document.name}</h1></div></div><a href={document.url} download className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl bg-teal-700 px-4 text-xs font-black text-white hover:bg-teal-600"><Download className="h-4 w-4" /><span className="hidden sm:inline">Download</span></a></header><iframe src={document.url} title={document.name} className="min-h-0 w-full flex-1 border-0 bg-white" referrerPolicy="no-referrer" /></main>
}

