const SERVICES = ['New Registration', 'Account Closure', 'Annual Return Filling', 'Audits - Producer/ PWP', 'Category 1 – EOL', 'Category 1 – Recycling', 'Category 2 – EOL', 'Category 2 – Recycling', 'Category 3 – EOL', 'Category 3 – Recycling', 'CIPET Registration Advisory', 'Consulting', 'Corporate training & awareness Consulting', 'Credit Procurement', 'CTO/CCA Renewal and Amendment', 'Data Uploading', 'E-Certificate Registration', 'Environmental Statement Form V', 'EPR KAVACH', 'Marking and labelling QR Code', 'Name Change Application – GPCB', 'CTE & CTO/CCA Expansion'];
const normalize = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
function normalizeYear(value) {
  const match = String(value || '').trim().match(/^(\d{4})\s*[-/]\s*(\d{2}|\d{4})$/);
  if (!match || Number(match[2].slice(-2)) !== (Number(match[1]) + 1) % 100) return '';
  return `${match[1]}-${match[2].slice(-2)}`;
}
function buildOverall(records, deactivations = [], selectedYear = '') {
  const inactive = new Set(deactivations.filter((row) => row.status === 'INACTIVE').map((row) => row.companyKey));
  const catalog = [...SERVICES];
  const canonicalService = (value) => {
    const raw = String(value || '').trim();
    const key = normalize(raw).replace('filing', 'filling');
    if (key === 'creditprocurement') return '';
    if (['annualreturnfilling', 'annualfilling', 'annualreturnfillingannualfilling'].includes(key)) return 'Annual Return Filling';
    const known = catalog.find((name) => normalize(name) === key);
    if (known) return known;
    if (raw) catalog.push(raw);
    return raw;
  };
  const byYear = new Map();
  const portfolio = new Map();
  for (const record of records) {
    if (!record.isClosed) continue;
    const year = normalizeYear(record.financialYear);
    if (!year || Number(year.slice(0, 4)) < 2025) continue;
    if (!byYear.has(year)) byYear.set(year, new Map());
    const clients = byYear.get(year);
    const key = String(record.companyIdentity || record.clientName || record.leadId).trim().toLowerCase().replace(/\s+/g, ' ');
    if (!clients.has(key)) clients.set(key, { key, name: record.clientName || 'Untitled client', clientId: record.clientId, inactive: inactive.has(key), types: new Map(), references: new Set() });
    const client = clients.get(key);
    if (record.leadNumber) client.references.add(record.leadNumber);
    portfolio.set(key, client.inactive);
    const type = record.subApplicantType && record.subApplicantType !== 'Not specified' ? record.subApplicantType : record.applicantType;
    const types = new Set([type || 'Not specified']);
    if (record.applicantType && !['pibo', 'simp', 'notspecified'].includes(normalize(record.applicantType))) types.add(record.applicantType);
    for (const entry of types) {
      if (!client.types.has(entry)) client.types.set(entry, new Set());
      (record.services || []).forEach((service) => { const name = canonicalService(service.name); if (name) client.types.get(entry).add(name); });
    }
  }
  const lastYear = Math.max(2025, ...[...byYear.keys()].map((year) => Number(year.slice(0, 4))));
  const yearOptions = Array.from({ length: lastYear - 2025 + 1 }, (_, index) => `${2025 + index}-${String(2026 + index).slice(-2)}`);
  const observedTypes = [...byYear.values()].flatMap((clients) => [...clients.values()].flatMap((client) => [...client.types.keys()]));
  const typeNames = [...new Set(['Producer', 'Brand Owner', 'PWP', 'Importer', ...observedTypes])].filter((type, index, list) => list.findIndex((other) => normalize(other) === normalize(type)) === index);
  const yearSections = yearOptions.map((year) => {
    const current = [...(byYear.get(year)?.values() || [])].sort((a, b) => a.name.localeCompare(b.name));
    const used = new Set(current.flatMap((client) => [...client.types.values()].flatMap((names) => [...names])));
    const totals = new Map();
    current.forEach((client) => new Set([...client.types.values()].flatMap((names) => [...names])).forEach((name) => totals.set(name, (totals.get(name) || 0) + 1)));
    const services = catalog.filter((name) => used.has(name)).sort((a, b) => totals.get(b) - totals.get(a));
    const serialize = (client, taken, types) => ({ key: client.key, name: client.name, clientId: client.clientId, references: [...client.references].sort(), inactive: client.inactive, types, services: Object.fromEntries(services.map((name) => [name, taken.has(name) ? 1 : 0])) });
    const clients = current.map((client) => serialize(client, new Set([...client.types.values()].flatMap((names) => [...names])), [...client.types.keys()]));
    const groups = typeNames.map((type) => {
      const members = current.filter((client) => [...client.types.keys()].some((entry) => normalize(entry) === normalize(type))).map((client) => serialize(client, new Set([...client.types].filter(([entry]) => normalize(entry) === normalize(type)).flatMap(([, names]) => [...names])), [type]));
      return { type, count: members.length, services: Object.fromEntries(services.map((name) => [name, members.reduce((sum, client) => sum + client.services[name], 0)])), clients: members };
    });
    const inactiveCount = clients.filter((client) => client.inactive).length;
    return { year, services, groups, clients, summary: { clients: clients.length, active: clients.length - inactiveCount, inactive: inactiveCount, services: clients.reduce((sum, client) => sum + Object.values(client.services).reduce((a, b) => a + b, 0), 0) } };
  });
  const financialYear = normalizeYear(selectedYear) || yearOptions.at(-1);
  const current = yearSections.find((section) => section.year === financialYear) || { services: [], groups: [], summary: { clients: 0, active: 0, inactive: 0, services: 0 } };
  const inactiveCount = [...portfolio.values()].filter(Boolean).length;
  return { financialYear, yearOptions, services: current.services, groups: current.groups, summary: current.summary, yearSections,
    trends: yearSections.map((section) => ({ year: section.year, clients: section.summary.clients, active: section.summary.active, inactive: section.summary.inactive })),
    portfolioSummary: { clients: portfolio.size, active: portfolio.size - inactiveCount, inactive: inactiveCount, services: yearSections.reduce((sum, section) => sum + section.summary.services, 0) }
  };
}
module.exports = { buildOverall, normalizeYear };
