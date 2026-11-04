
let pendingExport = false

function askExportReason(filename) {
  return new Promise(resolve => {
    const dialog = document.createElement('dialog')
    dialog.setAttribute('aria-labelledby', 'export-reason-title')
    dialog.style.cssText = 'width:min(520px,calc(100vw - 32px));border:1px solid #e2e8f0;border-radius:18px;padding:28px;color:#172033;box-shadow:0 24px 80px #0004'
    dialog.innerHTML = `<form><h2 id="export-reason-title" style="font-size:22px;font-weight:800;margin:0 0 12px">Why are you exporting this data?</h2><p style="font-size:14px;color:#64748b;margin-bottom:18px">Your reason, section, account and date/time will be recorded and emailed to Admin and Super Admin.</p><label for="export-reason" style="display:block;font-weight:700;margin-bottom:8px">Export reason</label><textarea id="export-reason" required minlength="5" maxlength="2000" rows="4" style="width:100%;padding:12px;border:1px solid #cbd5e1;border-radius:10px" placeholder="Describe the business purpose for this export"></textarea><p role="alert" style="color:#b91c1c;font-size:14px;margin:12px 0"></p><div style="display:flex;justify-content:flex-end;gap:10px;margin-top:20px"><button type="button" style="padding:10px 18px;border:1px solid #cbd5e1;border-radius:8px">Cancel</button><button type="submit" style="padding:10px 18px;background:#047857;color:white;font-weight:700;border-radius:8px">Continue export</button></div></form>`
    const form = dialog.querySelector('form')
    const cancel = dialog.querySelector('button[type=button]')
    const submit = dialog.querySelector('button[type=submit]')
    const input = dialog.querySelector('textarea')
    const error = dialog.querySelector('[role=alert]')
    let busy = false
    function finish(value) { dialog.close(); dialog.remove(); resolve(value) }
    cancel.onclick = () => finish(false)
    dialog.addEventListener('cancel', event => { event.preventDefault(); if (!busy) finish(false) })
    form.onsubmit = async event => {
      let readError = () => 'Export could not be authorized. Please retry.'
      event.preventDefault()
      if (busy) return
      if (input.value.trim().length < 5) { error.textContent = 'Enter at least 5 characters explaining the export.'; input.focus(); return }
      busy = true; submit.disabled = true; cancel.disabled = true; input.disabled = true; submit.textContent = 'Notifying administrators…'; error.textContent = ''
      try {
        const section = `${document.querySelector('h1')?.textContent?.trim() || 'CRM'} (${window.location.pathname})`.slice(0, 200)
        const { default: api, readApiError } = await import('../services/api')
        readError = readApiError
        await api.post('/data-exports', { reason: input.value.trim(), section, filename: String(filename || 'Data export') })
        finish(true)
      } catch (err) {
        error.textContent = readError(err, 'Export could not be authorized. Please retry.')
        busy = false; submit.disabled = false; cancel.disabled = false; input.disabled = false; submit.textContent = 'Continue export'
      }
    }
    document.body.appendChild(dialog)
    dialog.showModal()
    input.focus()
  })
}

export async function exportWithReason(filename, save) {
  let user
  try { user = JSON.parse(localStorage.getItem('user') || 'null') } catch { return false }
  if (!user) return false
  const roles = [user.role, ...(user.roles || [])].map(role => String(role).toLowerCase())
  if (roles.some(role => ['admin', 'superadmin'].includes(role))) { await save(); return true }
  if (pendingExport) return false
  pendingExport = true
  try {
    if (!(await askExportReason(filename))) return false
    await save()
    return true
  } finally { pendingExport = false }
}
