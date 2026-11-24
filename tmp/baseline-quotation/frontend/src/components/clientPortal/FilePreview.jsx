import React, { useEffect, useRef, useState } from 'react'
import { Download, FileText, X } from 'lucide-react'
import { documentUrl } from '../../utils/clientPortalPresentation.mjs'

export default function FilePreview({ file, onClose }) {
  const [preview, setPreview] = useState({ loading: true })
  const closeRef = useRef(null)
  const url = documentUrl(file.url)
  useEffect(() => {
    const controller = new AbortController()
    let blobUrl = ''
    const focused = window.document.activeElement
    const overflow = window.document.body.style.overflow
    window.document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    const keydown = event => {
      if (event.key === 'Escape') onClose()
      if (event.key === 'Tab') {
        const buttons = window.document.querySelectorAll('.cp-file-dialog a, .cp-file-dialog button, .cp-file-dialog iframe')
        const first = buttons[0], last = buttons[buttons.length - 1]
        if (event.shiftKey && window.document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && window.document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }
    window.addEventListener('keydown', keydown)
    async function load() {
      setPreview({ loading: true })
      if (!url) { setPreview({ error: 'This file link is unavailable.' }); return }
      try {
        const response = await fetch(url, { signal: controller.signal })
        if (!response.ok) throw new Error('Unable to load file')
        const blob = await response.blob()
        const type = blob.type.toLowerCase()
        const name = `${file.name || ''} ${decodeURIComponent(url)}`.toLowerCase()
        const kind = type.includes('pdf') || /\.pdf(?:[?&#\s]|$)/.test(name) ? 'pdf' : /^image\/(png|jpeg|gif|webp|bmp|avif)$/.test(type) || /\.(png|jpg|jpeg|gif|webp)(?:[?&#\s]|$)/.test(name) ? 'image' : type.startsWith('text/') ? 'text' : type.startsWith('video/') ? 'video' : type.startsWith('audio/') ? 'audio' : 'other'
        blobUrl = URL.createObjectURL(kind === 'pdf' ? new Blob([blob], { type: 'application/pdf' }) : blob)
        const text = kind === 'text' ? await blob.text() : ''
        if (!controller.signal.aborted) setPreview({ kind, url: blobUrl, text, loading: false })
      } catch (error) { if (!controller.signal.aborted) setPreview({ error: 'The preview could not load. You can download the file below.' }) }
    }
    load()
    return () => { controller.abort(); if (blobUrl) URL.revokeObjectURL(blobUrl); window.removeEventListener('keydown', keydown); window.document.body.style.overflow = overflow; focused?.focus?.() }
  }, [url, file.name, onClose])
  return <div className="cp cp-file-overlay" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}><section className="cp-file-dialog" role="dialog" aria-modal="true" aria-labelledby="cp-file-title"><header><span className="cp-stat-icon"><FileText size={22}/></span><div><h2 id="cp-file-title">{file.name || 'File preview'}</h2><p>{file.category || 'Client document'}</p></div><div className="cp-file-actions">{url && <a className="cp-button" href={preview.url || url} download={file.name || 'document'}><Download size={16}/>Download</a>}<button ref={closeRef} className="cp-button" onClick={onClose} aria-label="Close file preview"><X size={20}/></button></div></header><div className="cp-file-body">{preview.loading ? <p role="status">Loading file preview…</p> : preview.error ? <p role="alert">{preview.error}</p> : preview.kind === 'pdf' ? <iframe title={file.name || 'PDF preview'} src={preview.url}/> : preview.kind === 'image' ? <img alt={file.name || 'Document preview'} src={preview.url}/> : preview.kind === 'text' ? <pre>{preview.text}</pre> : preview.kind === 'video' ? <video controls src={preview.url}/> : preview.kind === 'audio' ? <audio controls src={preview.url}/> : <div className="cp-file-unsupported"><FileText size={42}/><h3>{file.name || 'Document'}</h3><p>This file format does not support an inline preview. Use Download to open it in its app.</p></div>}</div></section></div>
}
