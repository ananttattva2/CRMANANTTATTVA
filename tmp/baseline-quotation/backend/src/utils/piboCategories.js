const QuotationPiboCategory = require('../models/QuotationPiboCategory');

const PIBO_PARENTS = ['PIBO', 'SIMP', 'PWP'];
const BUILT_IN_PIBO_CATEGORIES = Object.freeze({
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

function cleanCategoryName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizeParent(value) {
  const parent = cleanCategoryName(value).toUpperCase();
  return PIBO_PARENTS.includes(parent) ? parent : '';
}

function normalizedCategoryName(parent, name) {
  return `${normalizeParent(parent).toLowerCase()}:${cleanCategoryName(name).toLowerCase()}`;
}

function inferPiboParent(child) {
  const name = cleanCategoryName(child).toLowerCase();
  if (!name) return '';
  for (const [parent, children] of Object.entries(BUILT_IN_PIBO_CATEGORIES)) {
    if (children.some((item) => item.toLowerCase() === name)) return parent;
  }
  if (name === 'simp (legacy)' || name.startsWith('simp -') || name.startsWith('simp –')) return 'SIMP';
  if (name === 'pwp') return 'PWP';
  return '';
}

function normalizeLegacyPiboCategory(value) {
  const raw = cleanCategoryName(value);
  const key = raw.toUpperCase().replace(/[\s-]+/g, '_');
  return LEGACY_PIBO_CATEGORY_MAP[raw.toUpperCase()]
    || LEGACY_PIBO_CATEGORY_MAP[key]
    || { parent: inferPiboParent(raw), child: raw };
}

function isBuiltInCategory(parent, name) {
  const normalizedParent = normalizeParent(parent);
  const normalizedName = cleanCategoryName(name).toLowerCase();
  return Boolean(normalizedParent && BUILT_IN_PIBO_CATEGORIES[normalizedParent]
    .some((item) => item.toLowerCase() === normalizedName));
}

async function validatePiboSelection({ parent, child, required = true }) {
  const legacy = normalizeLegacyPiboCategory(child);
  const name = cleanCategoryName(legacy.child);
  const suppliedParent = cleanCategoryName(parent);
  const explicitParent = normalizeParent(suppliedParent);
  if (suppliedParent && !explicitParent) {
    throw Object.assign(new Error('Applicant Type must be PIBO, SIMP, or PWP.'), { statusCode: 400 });
  }
  const normalizedParent = explicitParent || legacy.parent || inferPiboParent(name);
  if (!normalizedParent) {
    if (!required && !name) return { piboParent: undefined, piboCategory: undefined };
    throw Object.assign(new Error('Applicant Type is required and must be PIBO, SIMP, or PWP.'), { statusCode: 400 });
  }
  if (!name) {
    throw Object.assign(new Error(`${normalizedParent} Category is required.`), { statusCode: 400 });
  }
  if (name.length > 60) {
    throw Object.assign(new Error('PIBO subcategory must be 60 characters or fewer.'), { statusCode: 400 });
  }
  if (!isBuiltInCategory(normalizedParent, name)) {
    const builtInParent = inferPiboParent(name);
    if (builtInParent && builtInParent !== normalizedParent) {
      throw Object.assign(new Error(`“${name}” belongs to ${builtInParent}, not ${normalizedParent}.`), { statusCode: 400 });
    }
    const exists = await QuotationPiboCategory.exists({ normalizedName: normalizedCategoryName(normalizedParent, name) });
    if (!exists) {
      throw Object.assign(new Error(`“${name}” is not a valid ${normalizedParent} category.`), { statusCode: 400 });
    }
  }
  return { piboParent: normalizedParent, piboCategory: name };
}

module.exports = {
  PIBO_PARENTS,
  BUILT_IN_PIBO_CATEGORIES,
  cleanCategoryName,
  normalizeParent,
  normalizedCategoryName,
  inferPiboParent,
  normalizeLegacyPiboCategory,
  isBuiltInCategory,
  validatePiboSelection
};
