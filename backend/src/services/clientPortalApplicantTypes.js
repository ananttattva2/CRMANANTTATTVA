const { BUILT_IN_PIBO_CATEGORIES, PIBO_PARENTS } = require('../utils/piboCategories');
const Category = require('../models/QuotationPiboCategory');
async function applicantTypes() {
  const custom = await Category.find({}).select('name').lean();
  return [...new Set([...PIBO_PARENTS, ...Object.values(BUILT_IN_PIBO_CATEGORIES).flat(), 'Manufacturer', 'Retreader', 'Producers', 'Collection Agents', 'Recyclers', 'Used Oil Importers', 'Service Provider', ...custom.map(row => row.name)].filter(Boolean))].sort();
}
module.exports = { applicantTypes };
