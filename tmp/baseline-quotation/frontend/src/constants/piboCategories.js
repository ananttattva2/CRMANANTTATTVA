export const PIBO_PARENTS = ['PIBO', 'SIMP', 'PWP'];

export const BUILT_IN_PIBO_CATEGORIES = Object.freeze({
  PIBO: ['Producer', 'Brand Owner', 'Importer'],
  SIMP: ['Producer (Small & Micro)', 'Importer of Raw Material', 'Manufacturer of Raw Material', 'Seller'],
  PWP: ['PWP', 'Recycler', 'Refurbisher', 'Waste to Energy', 'Waste to Oil', 'Cement Co-processing']
});

const LEGACY_PIBO_CATEGORY_MAP = Object.freeze({
  PRODUCER: { parent: 'PIBO', child: 'Producer' },
  'BRAND OWNER': { parent: 'PIBO', child: 'Brand Owner' },
  BRAND_OWNER: { parent: 'PIBO', child: 'Brand Owner' },
  IMPORTER: { parent: 'PIBO', child: 'Importer' },
  PWP: { parent: 'PWP', child: 'PWP' },
  RECYCLER: { parent: 'PWP', child: 'Recycler' },
  REFURBISHER: { parent: 'PWP', child: 'Refurbisher' },
  SIMP_PRODUCER: { parent: 'SIMP', child: 'Producer (Small & Micro)' },
  SIMP_IMPORTER_RAW: { parent: 'SIMP', child: 'Importer of Raw Material' },
  SIMP_MANUFACTURER_RAW: { parent: 'SIMP', child: 'Manufacturer of Raw Material' },
  SIMP_SELLER: { parent: 'SIMP', child: 'Seller' }
});

export function normalizeLegacyPiboCategory(value = '') {
  const raw = String(value || '').trim();
  const key = raw.toUpperCase().replace(/[\s-]+/g, '_');
  return LEGACY_PIBO_CATEGORY_MAP[raw.toUpperCase()]
    || LEGACY_PIBO_CATEGORY_MAP[key]
    || { parent: inferPiboParent(raw), child: raw };
}

export function inferPiboParent(child = '') {
  const name = String(child || '').trim().toLowerCase();
  if (!name) return '';
  for (const [parent, children] of Object.entries(BUILT_IN_PIBO_CATEGORIES)) {
    if (children.some((item) => item.toLowerCase() === name)) return parent;
  }
  if (name === 'simp (legacy)' || name.startsWith('simp -') || name.startsWith('simp –')) return 'SIMP';
  if (name === 'pwp') return 'PWP';
  return '';
}

export function normalizePiboCategories(categories = []) {
  const builtIn = Object.entries(BUILT_IN_PIBO_CATEGORIES)
    .flatMap(([parent, names]) => names.map((name) => ({ parent, name, custom: false })));
  const normalized = [...builtIn, ...categories]
    .map((category) => typeof category === 'string'
      ? ({ parent: inferPiboParent(category), name: category })
      : ({ parent: String(category?.parent || '').toUpperCase(), name: String(category?.name || '').trim(), custom: Boolean(category?.custom) }))
    .filter((category) => PIBO_PARENTS.includes(category.parent) && category.name);
  return normalized.filter((category, index) => normalized.findIndex((item) => (
    item.parent === category.parent && item.name.toLowerCase() === category.name.toLowerCase()
  )) === index);
}

export function categoryLabel(record = {}) {
  const child = record.piboCategory || '';
  const parent = record.piboParent || record.piboCategoryParent || inferPiboParent(child);
  return [parent, child].filter(Boolean).join(' → ') || '-';
}
