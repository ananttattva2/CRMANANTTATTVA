// MongoDB rejects projections containing both a parent and one of its children.
function inclusionProjection(fields = []) {
  const unique = [...new Set(fields)];
  return unique.filter((field) => !unique.some((parent) => field.startsWith(`${parent}.`))).join(' ');
}

module.exports = { inclusionProjection };
