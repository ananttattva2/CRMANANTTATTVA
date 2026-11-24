from pathlib import Path
p=Path('frontend/src/utils/salesRepSummary.mjs');s=p.read_text();s+='''
// Unowned leads are a separate Hot Leads bucket, never a representative.
export function salesRepTableData(allReps = []) {
  const isUnassigned = rep => !String(rep.owner || '').trim() || String(rep.owner).trim().toLowerCase() === 'unassigned';
  const keys = ['totalLeads', 'hotOpen', 'hotClosed', 'coldOpen', 'expectedRevenuePaise', 'poValuePaise', 'previousTotalLeads', 'previousHotOpen', 'previousHotClosed', 'previousColdOpen', 'previousExpectedRevenuePaise', 'previousPoValuePaise'];
  const sum = rows => rows.reduce((total, rep) => {
    for (const key of keys) total[key] += Number(rep[key]) || 0;
    return total;
  }, Object.fromEntries(keys.map(key => [key, 0])));
  const reps = allReps.filter(rep => !isUnassigned(rep));
  const unassigned = sum(allReps.filter(isUnassigned));
  const totals = sum(allReps);
  totals.hotOpen -= unassigned.hotOpen;
  totals.hotClosed -= unassigned.hotClosed;
  totals.previousHotOpen -= unassigned.previousHotOpen;
  totals.previousHotClosed -= unassigned.previousHotClosed;
  totals.hotUnassigned = unassigned.hotOpen + unassigned.hotClosed;
  totals.previousHotUnassigned = unassigned.previousHotOpen + unassigned.previousHotClosed;
  return { reps, unassigned, totals };
}
''';p.write_text(s)
p=Path('frontend/src/pages/LeadPipeline.jsx');s=p.read_text(encoding='utf-8').replace("import { salesRepSummary }", "import { salesRepSummary, salesRepTableData }");start=s.index('function SalesDashboardRepTable(');end=s.index('\nfunction SalesTrafficStrip',start);part=s[start:end];part=part.replace('({ reps, comparisonLabel', '({ reps: allReps, comparisonLabel');part=part.replace('  const [page, setPage]', '  const { reps, totals } = useMemo(() => salesRepTableData(allReps), [allReps]);\n  const [page, setPage]',1);a=part.index('  const totals = useMemo(');b=part.index('  useEffect(',a);part=part[:a]+part[b:];part=part.replace("'Hot Open': rep.hotOpen, 'Hot Closed': rep.hotClosed", "'Hot Closed': rep.hotClosed, 'Hot Open': rep.hotOpen, 'Hot Unassigned': 0");part=part.replace('const sheet = XLSX.utils.json_to_sheet(reps.map', 'const exportRows = reps.map').replace("    })));", "    }));\n    exportRows.push({ 'Sales Representative': 'Grand Total', 'Total Leads': totals.totalLeads, 'Hot Closed': totals.hotClosed, 'Hot Open': totals.hotOpen, 'Hot Unassigned': totals.hotUnassigned, 'Cold Open': totals.coldOpen, 'Expected Revenue (INR)': totals.expectedRevenuePaise / 100, 'PO Value (INR)': totals.poValuePaise / 100 });\n    const sheet = XLSX.utils.json_to_sheet(exportRows);")
part=part.replace('disabled={!reps.length}', 'disabled={!allReps.length}')
part=part.replace('<th colSpan="2">Hot Leads<div><small>Open</small><small>Closed</small></div></th>', '<th colSpan="3">Hot Leads<div className="has-unassigned"><small>Closed</small><small>Open</small><small>Unassigned <button type="button" className="sales-unassigned-count" aria-label={`${totals.hotUnassigned} unassigned hot leads`} onClick={() => onMetricClick(\'Unassigned\', \'hot\', \'\')}>{totals.hotUnassigned.toLocaleString(\'en-IN\')}</button></small></div></th>')
a=part.index('<td className="is-hot"><RepMetric');b=part.index('<td className="is-cold">',a);cells=part[a:b];split=cells.index('<td className="is-closed">');part=part[:a]+cells[split:]+cells[:split]+'<td className="is-unassigned"><span title="Unassigned leads have no sales representative">—</span></td>'+part[b:]
part=part.replace('{!!reps.length && <tfoot>', '{!!allReps.length && <tfoot>').replace('All {reps.length} representatives', 'All {reps.length} representatives + unassigned')
part=part.replace('<td className="is-hot">{totals.hotOpen.toLocaleString(\'en-IN\')}</td><td className="is-closed">{totals.hotClosed.toLocaleString(\'en-IN\')}</td>', '<td className="is-closed">{totals.hotClosed.toLocaleString(\'en-IN\')}</td><td className="is-hot">{totals.hotOpen.toLocaleString(\'en-IN\')}</td><td className="is-unassigned"><RepMetric value={totals.hotUnassigned} previous={totals.previousHotUnassigned} comparisonLabel={comparisonLabel} label="Unassigned hot leads" onClick={() => onMetricClick(\'Unassigned\', \'hot\', \'\')}/></td>')
s=s[:start]+part+s[end:];p.write_text(s,encoding='utf-8')
p=Path('frontend/src/styles/lead-pipeline.css');s=p.read_text();s+='''
.sales-dashboard-reps th div.has-unassigned { grid-template-columns:repeat(3,minmax(0,1fr)); }
.sales-dashboard-reps .sales-unassigned-count { display:inline-flex; align-items:center; justify-content:center; min-width:22px; margin-left:3px; padding:2px 5px; border:1px solid #fed7aa; border-radius:6px; background:#fff7ed; color:#c2410c; font-weight:900; }
.sales-dashboard-reps td.is-unassigned, .sales-dashboard-reps tfoot td.is-unassigned { color:#c2410c; }
.sales-dashboard-reps td.is-unassigned button { color:#c2410c; font-size:12px; }
.sales-dashboard-reps th:nth-child(3) { width:23%; }
.sales-dashboard-reps table { min-width:1020px; }
''';p.write_text(s)
