// Converted Cold rows are funnel history; prefer the Hot row for overall totals.
export function uniquePipelineRows(rows = []) {
  const unique = new Map();
  for (const row of rows) {
    const key = row.canonicalKey || `${row.kind}:${row.id}`;
    if (!unique.has(key) || row.kind === 'hot') unique.set(key, row);
  }
  return [...unique.values()];
}

// Calendar periods use local dates, Monday-based weeks and exclusive end bounds.
export function pipelinePeriodRange(period, value) {
  if (period === 'all') return { label: 'All time' };
  const start = new Date(`${value}T00:00:00`);
  if (!Number.isFinite(start.getTime())) return { label: 'Invalid date', invalid: true };
  if (period === 'week') start.setDate(start.getDate() - (start.getDay() + 6) % 7);
  if (period === 'month') start.setDate(1);
  if (period === 'year') start.setMonth(0, 1);
  const end = new Date(start);
  if (period === 'week') end.setDate(end.getDate() + 7);
  if (period === 'month') end.setMonth(end.getMonth() + 1);
  if (period === 'year') end.setFullYear(end.getFullYear() + 1);
  const last = new Date(end); last.setDate(last.getDate() - 1);
  const format = date => date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  return { start: start.getTime(), end: end.getTime(), label: `${format(start)} – ${format(last)}` };
}
export function inPipelinePeriod(value, range) {
  if (range.invalid) return false;
  if (range.start === undefined) return true;
  if (!value) return false;
  const timestamp = new Date(value).getTime();
  return timestamp >= range.start && timestamp < range.end;
}

export function previousPipelinePeriodRange(period, value) {
  if (!['week', 'month'].includes(period)) return null;
  const current = pipelinePeriodRange(period, value);
  if (current.invalid || current.start === undefined) return null;
  const previousDate = new Date(current.start);
  if (period === 'week') previousDate.setDate(previousDate.getDate() - 7);
  else previousDate.setMonth(previousDate.getMonth() - 1);
  const localValue = `${previousDate.getFullYear()}-${String(previousDate.getMonth() + 1).padStart(2, '0')}-${String(previousDate.getDate()).padStart(2, '0')}`;
  return pipelinePeriodRange(period, localValue);
}
