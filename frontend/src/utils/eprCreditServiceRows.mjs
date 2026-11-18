export function isEprCreditBusinessCategory(value) {
  return String(value || '').trim().toLowerCase() === 'epr credit';
}

export function expandEprCreditServiceRow(row = {}, createId) {
  const services = [...new Map(
    String(row.servicesOffered || '')
      .split(',')
      .map((service) => service.trim())
      .filter(Boolean)
      .map((service) => [service.toLowerCase(), service])
  ).values()];

  if (!isEprCreditBusinessCategory(row.businessCategory) || !row.firstAnnualReturnYearApplicable || services.length < 2) {
    return [row];
  }

  return services.map((service, index) => ({
    ...row,
    assignedServiceId: index === 0 && row.assignedServiceId ? row.assignedServiceId : createId(),
    servicesOffered: service
  }));
}
