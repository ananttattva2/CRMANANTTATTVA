// Converted Cold rows are funnel history; prefer the Hot row for overall totals.
export function uniquePipelineRows(rows = []) {
  const unique = new Map();
  for (const row of rows) {
    const key = row.canonicalKey || `${row.kind}:${row.id}`;
    if (!unique.has(key) || row.kind === 'hot') unique.set(key, row);
  }
  return [...unique.values()];
}

// A converted Cold lead belongs to the Hot pipeline. The API may retain its
// Cold row for audit history, but operational dashboard totals must show it once.
export function currentPipelineRows(rows = []) {
  return rows.filter(row => !(row.kind === 'cold' && row.converted));
}

// Calendar periods use local dates, Monday-based weeks and exclusive end bounds.
export function pipelinePeriodRange(period, value) {
  if (period === 'all') return { label: 'All time' };
  const start = new Date(`${value}T00:00:00`);
  if (!Number.isFinite(start.getTime())) return { label: 'Invalid date', invalid: true };
  if (period === 'week') start.setDate(start.getDate() - (start.getDay() + 6) % 7);
  if (period === 'month') start.setDate(1);
  if (period === 'quarter') start.setMonth(Math.floor(start.getMonth() / 3) * 3, 1);
  if (period === 'year') start.setMonth(0, 1);
  const end = new Date(start);
  if (period === 'week') end.setDate(end.getDate() + 7);
  if (period === 'month') end.setMonth(end.getMonth() + 1);
  if (period === 'quarter') end.setMonth(end.getMonth() + 3);
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
  if (!['week', 'month', 'quarter'].includes(period)) return null;
  const current = pipelinePeriodRange(period, value);
  if (current.invalid || current.start === undefined) return null;
  const previousDate = new Date(current.start);
  if (period === 'week') previousDate.setDate(previousDate.getDate() - 7);
  else if (period === 'month') previousDate.setMonth(previousDate.getMonth() - 1);
  else previousDate.setMonth(previousDate.getMonth() - 3);
  const localValue = `${previousDate.getFullYear()}-${String(previousDate.getMonth() + 1).padStart(2, '0')}-${String(previousDate.getDate()).padStart(2, '0')}`;
  return pipelinePeriodRange(period, localValue);
}
