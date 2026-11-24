function text(value) {
  return String(value || '').trim();
}

function normalizeCompanyIdentity(value) {
  let normalized = text(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/\bCORPORATION\b/g, ' CORP ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Legal forms are not part of a company's business identity. Strip any
  // repeated trailing variants so "Acme", "Acme Pvt Ltd" and even imported
  // values such as "Acme Private Limited Limited Liability" resolve alike.
  const legalSuffix = /\s+(?:(?:PRIVATE|PVT)\s+(?:LIMITED|LTD)|LIMITED\s+LIABILITY(?:\s+PARTNERSHIP)?|LLP|LIMITED|LTD)$/;
  while (legalSuffix.test(normalized)) normalized = normalized.replace(legalSuffix, '').trim();
  return normalized;
}

module.exports = {
  normalizeCompanyIdentity
};
