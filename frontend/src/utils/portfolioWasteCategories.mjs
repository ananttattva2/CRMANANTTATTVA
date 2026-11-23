export const PORTFOLIO_WASTE_CATEGORIES = [
  { key: 'plastic', label: 'Plastic', abbreviation: 'PL' },
  { key: 'battery', label: 'Battery', abbreviation: 'BT' },
  { key: 'ewaste', label: 'E-Waste', abbreviation: 'EW' }
]
export function portfolioWasteCategory(value) {
  const key = String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  if (key.includes('plastic')) return 'plastic'
  if (/batter(?:y|ies)/.test(key)) return 'battery'
  if (/ewaste|electronic|electricalwaste/.test(key)) return 'ewaste'
  return ''
}
export function portfolioGroupsForWasteCategory(groups = [], category) {
  return groups.map(group => ({ ...group, records: group.records.flatMap(record => {
    const services = (record.services || []).filter(service => portfolioWasteCategory(service.eprCategory || record.eprCategory) === category)
    return services.length ? [{ ...record, ...services[0], services, sourceIds: services.map(service => service.id) }] : []
  }) }))
}
