export function buildClientExportRows(clients, year, services) {
  return clients.map((client, index) => ({
    'No.': index + 1,
    'Financial Year': year,
    'Client': client.name,
    'Lead / Client Number': (client.references || []).join(', '),
    'Applicant / Sub-applicant': (client.types || []).join(', '),
    'Status': client.inactive ? 'Inactive' : 'Active',
    'Closed Services': Object.values(client.services).reduce((sum, value) => sum + Number(value || 0), 0),
    ...Object.fromEntries(services.map((service) => [service, Number(client.services[service] || 0)]))
  }));
}
