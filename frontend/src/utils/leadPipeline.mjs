// Converted Cold rows are funnel history; prefer the Hot row for overall totals.
export function uniquePipelineRows(rows = []) {
  const unique = new Map();
  for (const row of rows) {
    const key = row.canonicalKey || `${row.kind}:${row.id}`;
    if (!unique.has(key) || row.kind === 'hot') unique.set(key, row);
  }
  return [...unique.values()];
}
