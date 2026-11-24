import React from 'react'
import { Eye } from 'lucide-react'
export default function PoProofView({ po = {} }) {
  const url = String(po.poFileUrl || '').trim()
  if (!/^(https?:\/\/|\/(?!\/))/.test(url)) return null
  return <a href={url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex min-h-9 items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-black text-emerald-800"><Eye className="h-4 w-4" />View PO Proof</a>
}
