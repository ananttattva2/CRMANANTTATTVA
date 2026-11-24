// Prefer whole table rows at page boundaries, including very long reports.
export function reportPageRanges(height, pageHeight, protectedBlocks = []) {
  const pages = []
  let start = 0
  while (start < height) {
    let end = Math.min(height, start + pageHeight)
    if (end < height) {
      const crossing = protectedBlocks.filter((block) => block.top < end && block.bottom > end)
      const safe = crossing.length ? Math.min(...crossing.map((block) => block.top)) : end
      if (safe > start + 1) end = safe
    }
    pages.push({ start, end })
    start = end
  }
  return pages
}

export async function downloadOperationsReportPdf(element, onProgress = () => {}, options = {}) {
  if (!element) throw new Error('The report is not ready. Please try again.')
  onProgress('Loading PDF tools…')
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')])
  const width = options.width || 1800
  const frame = document.createElement('iframe')
  frame.title = options.title || 'Operations report PDF'
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = `position:fixed;left:-20000px;top:0;width:${width}px;height:1000px;border:0;pointer-events:none;zoom:1`
  try {
    const ready = new Promise((resolve, reject) => { frame.onload = resolve; frame.onerror = reject })
    frame.srcdoc = '<!doctype html><html><head></head><body></body></html>'
    document.body.appendChild(frame)
    await ready
    onProgress('Loading report styles…')
    const doc = frame.contentDocument
    const stylesReady = [...document.querySelectorAll('style,link[rel="stylesheet"]')].map((original) => {
      const copy = doc.importNode(original, true)
      if (copy.tagName !== 'LINK') { doc.head.appendChild(copy); return Promise.resolve() }
      copy.href = original.href
      return new Promise((resolve, reject) => {
        copy.onload = resolve
        copy.onerror = () => reject(new Error('Report styles could not load. Please retry.'))
        doc.head.appendChild(copy)
      })
    })
    await Promise.all(stylesReady)
    const root = doc.importNode(element, true)
    root.classList.add('operations-pdf-root')
    doc.body.appendChild(root)
    const reset = doc.createElement('style')
    reset.textContent = `html,body{width:${width}px!important;margin:0!important;padding:0!important;background:#fff!important;zoom:1!important;transform:none!important}*,*::before,*::after{animation:none!important;transition:none!important}.operations-pdf-root{width:${width}px!important;margin:0!important;position:static!important;opacity:1!important;transform:none!important;zoom:1!important}.operations-user-status-scroll{max-height:none!important;height:auto!important;overflow:visible!important}.operations-user-summary-row{opacity:1!important;transform:none!important}.operations-user-status-table{width:100%!important;min-width:0!important}.operations-status-date,.operations-po-number,.operations-sla-date{line-height:1.6!important;overflow:visible!important;white-space:normal!important;overflow-wrap:anywhere!important}.operations-user-progress i{box-shadow:none!important}.operations-client-details,.operations-user-detail-row,.operations-user-toolbar,.operations-pdf-hide{display:none!important}`
    doc.head.appendChild(reset)
    root.style.boxSizing = 'border-box'
    // html2canvas doesn't support color-mix; resolve the progress labels explicitly.
    root.querySelectorAll('.operations-user-progress').forEach((progress) => {
      const tone = progress.classList.contains('operations-user-progress-red') ? '#dc2626' : '#059669'
      progress.querySelector('strong').style.color = tone
      const label = progress.querySelector('small')?.textContent || '0%'
      progress.querySelector('i').style.width = label
    })
    onProgress('Preparing report pages…')
    await doc.fonts.ready
    // Offscreen iframes can suspend animation frames; a layout read works without rAF.
    await new Promise((resolve) => setTimeout(resolve, 0))
    // html2canvas replaces SVGs with images in its clone, which can shrink table
    // rows. Freeze measured cell/block heights before calculating page breaks.
    root.querySelectorAll('th,td,.operations-user-status-heading,.operations-report-meta,.compliance-kpi-root,.compliance-kpi-branch>header,.compliance-kpi-waste-row').forEach((block) => {
      const height = block.getBoundingClientRect().height
      block.style.boxSizing = 'border-box'
      block.style.height = `${height}px`
      block.style.minHeight = `${height}px`
    })
    const bounds = root.getBoundingClientRect()
    const height = Math.ceil(bounds.height)
    const protectedBlocks = [...root.querySelectorAll('.operations-user-status-heading,.operations-user-summary-row,.operations-user-status-table>thead,.operations-user-status-table>tfoot,.operations-client-empty')]
      .map((block) => { const rect = block.getBoundingClientRect(); return { top: Math.floor(rect.top - bounds.top), bottom: Math.ceil(rect.bottom - bounds.top) } })
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3', compress: true })
    const printableWidth = 400
    const printableHeight = 269
    const ranges = reportPageRanges(height, Math.floor(printableHeight * width / printableWidth), protectedBlocks)
    for (let index = 0; index < ranges.length; index += 1) {
      onProgress(`Preparing page ${index + 1} of ${ranges.length}…`)
      const { start, end } = ranges[index]
      // Capture one page at a time to avoid browser canvas limits with hundreds of clients.
      const canvas = await html2canvas(root, { scale: 2, width, height: end - start, y: start,
        windowWidth: width, windowHeight: Math.max(1000, end - start), scrollX: 0, scrollY: 0,
        backgroundColor: '#ffffff', useCORS: true, logging: false })
      if (index) pdf.addPage()
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 10, 10, printableWidth, (end - start) * printableWidth / width, undefined, 'FAST')
      pdf.setFontSize(9)
      pdf.setTextColor(100, 116, 139)
      pdf.text(options.title || 'Operations - Client Ownership & Red Flags', 10, 289)
      pdf.text(`${index + 1} / ${ranges.length}`, 410, 289, { align: 'right' })
      canvas.width = 0
      canvas.height = 0
    }
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
    onProgress('Saving PDF…')
    pdf.save(`${options.filename || "Operations-Client-Report"}-${day}.pdf`)
  } finally {
    frame.remove()
  }
}
