const number = (value) => Number(value || 0)
const normalizedRole = (row) => String(row?.role || row?.roleLabel || '').trim().toLowerCase().replace(/[\s_-]+/g, ' ')

export function salesMisDepartment(row = {}) {
  const role = normalizedRole(row)
  const team = String(row.team || '').trim().toLowerCase()
  if (['super admin', 'superadmin', 'management'].includes(role) || team.includes('management')) return 'Management'
  if (role === 'sales' || team.includes('sales')) return 'Sales Team'
  return ''
}

export function buildSalesMisReport(rows = []) {
  const owners = rows.filter((row) => normalizedRole(row) !== 'admin' && salesMisDepartment(row)).map((row) => ({
    ...row,
    reportDepartment: salesMisDepartment(row),
    totalLeads: number(row.totalLeads),
    openLeads: number(row.openLeads),
    closedLeads: number(row.closedLeads),
    temporaryLeads: number(row.temporaryLeads),
    closeRate: number(row.totalLeads) ? Math.round(number(row.closedLeads) / number(row.totalLeads) * 100) : 0
  }))
  const groups = ['Sales Team', 'Management'].map((name) => {
    const members = owners.filter((row) => row.reportDepartment === name)
    const totals = members.reduce((sum, row) => ({
      total: sum.total + row.totalLeads,
      open: sum.open + row.openLeads,
      closed: sum.closed + row.closedLeads,
      temporary: sum.temporary + row.temporaryLeads
    }), { total: 0, open: 0, closed: 0, temporary: 0 })
    return { name, members, users: members.length, ...totals, closeRate: totals.total ? Math.round(totals.closed / totals.total * 100) : 0 }
  }).filter((group) => group.users)
  const totals = owners.reduce((sum, row) => ({
    total: sum.total + row.totalLeads,
    open: sum.open + row.openLeads,
    closed: sum.closed + row.closedLeads,
    temporary: sum.temporary + row.temporaryLeads
  }), { total: 0, open: 0, closed: 0, temporary: 0 })
  totals.closeRate = totals.total ? Math.round(totals.closed / totals.total * 100) : 0
  const ranked = [...owners].sort((a, b) => b.closedLeads - a.closedLeads || b.closeRate - a.closeRate || a.name.localeCompare(b.name))
  const openLeaders = [...owners].sort((a, b) => b.openLeads - a.openLeads || a.name.localeCompare(b.name)).slice(0, 2)
  const focusOpen = openLeaders.reduce((sum, row) => sum + row.openLeads, 0)
  return { owners, groups, totals, ranked, openLeaders, focusOpen, focusPercent: totals.open ? Math.round(focusOpen / totals.open * 100) : 0 }
}
