export function documentViewerHref(url, name = 'Document') {
  const value = String(url || '').trim()
  if (!/^(https?:|data:|blob:)/i.test(value)) return ''
  const params = new URLSearchParams({ url: value, name: String(name || 'Document') })
  return `/document-viewer#${params.toString()}`
}

