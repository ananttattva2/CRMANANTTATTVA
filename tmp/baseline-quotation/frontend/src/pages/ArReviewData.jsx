import React, { useState } from 'react';
import { ExternalLink, FileSpreadsheet } from 'lucide-react';
import ArReadonlyTracker from './ArReadonlyTracker';
const metric = value => Number(value || 0).toLocaleString('en-IN', {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3
});
export function ReadonlyValue({
  value
}) {
  if (value === undefined || value === null || value === '') return <span className="ar-muted">—</span>;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.length ? <div className="grid gap-1">{value.map((entry, index) => <ReadonlyValue key={index} value={entry} />)}</div> : <span className="ar-muted">No entries</span>;
  if (typeof value === 'object') {
    const url = value.secureUrl || value.url || value.secure_url;
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) return <a className="ar-document" href={url} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} />{value.name || value.fileName || 'View document'}</a>;
    if ((value.name || value.fileName) && (value.provider || value.mimeType || value.publicId || value.resourceType || value.type)) return <span>{value.name || value.fileName}</span>;
    return <div className="grid gap-1">{Object.entries(value).map(([key, item]) => <div key={key}><span className="ar-muted">{key}: </span><ReadonlyValue value={item} /></div>)}</div>;
  }
  if (typeof value === 'string' && /^https?:\/\//i.test(value)) return <a className="ar-document" href={value} target="_blank" rel="noopener noreferrer">View document <ExternalLink size={13} /></a>;
  return String(value);
}
export function ReadonlyTable({
  rows = [],
  columns = [],
  tone = ''
}) {
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(rows.length / 50));
  return <div className={`ar-data-table ${tone}`}><div className="ar-table-scroll"><table className="ar-table"><thead><tr>{columns.map(column => <th key={column.key}>{column.label}</th>)}</tr></thead><tbody>{rows.slice((page - 1) * 50, page * 50).map((row, index) => <tr key={index}>{columns.map(column => <td key={column.key}><ReadonlyValue value={row[column.key]} /></td>)}</tr>)}</tbody></table>{!rows.length && <p className="ar-empty">No entries in this table.</p>}</div>{rows.length > 50 && <div className="ar-pagination"><span>{rows.length} rows · {page}/{pages}</span><button type="button" disabled={page === 1} onClick={() => setPage(value => value - 1)}>Previous rows</button><button type="button" disabled={page === pages} onClick={() => setPage(value => value + 1)}>Next rows</button></div>}</div>;
}
export default function ArReviewData({
  field
}) {
  if (field.kind === 'tracker') return <ArReadonlyTracker field={field} renderValue={ReadonlyValue} />;
  if (/Entity List$/.test(field.label)) {
    const registered = field.label.startsWith('Registered');
    return <section className={`ar-entity-list ${registered ? 'ar-registered' : 'ar-unregistered'}`} aria-label={field.label}><header>{field.label}</header><div className="ar-table-scroll"><table className="ar-table"><thead><tr>{['Name', 'Base', 'Portal', 'Diff', 'GST diff', 'Status'].map(title => <th key={title}>{title}</th>)}</tr></thead><tbody>{field.rows.map((row, index) => <tr key={`${row.gstin || row.name}:${index}`}><td><strong>{row.name}</strong><small>{row.gstin || 'No GSTIN'}</small></td>{['baseQty', 'portalQty', 'qtyDiff', 'gstDiff'].map(key => <td key={key}>{metric(row[key])}</td>)}<td><span className={`ar-entity-result ${row.result === 'Missing on Portal' ? 'is-missing' : ''}`}>{row.result || '—'}</span></td></tr>)}</tbody></table>{!field.rows.length && <p className="ar-empty">No entities in this list.</p>}</div></section>;
  }
  if (field.kind === 'table') return <ReadonlyTable rows={field.rows} columns={field.columns} tone={field.label.startsWith('Registered') ? 'ar-registered' : field.label.startsWith('Unregistered') ? 'ar-unregistered' : ''} />;
  if (field.kind === 'upload') return <div className="ar-excel-card"><FileSpreadsheet size={22} /><div><strong>{field.upload.name || field.upload.fileName || field.label}</strong><p className="ar-muted">{field.upload.importedRowCount ?? field.upload.totalRows ?? 0} rows · {metric(field.upload.totalQuantity)} MT · {field.upload.importStatus}</p>{field.upload.url || field.upload.secureUrl ? <ReadonlyValue value={field.upload} /> : <p className="ar-muted">Imported Excel rows are shown in the table below.</p>}</div></div>;
  if (field.kind === 'summary') {
    return <><div className="ar-summary-metrics">{[['Data to upload', 'baseQty'], ['Uploaded on portal', 'portalQty'], ['Qty diff', 'qtyDiff'], ['GST to upload', 'baseGst'], ['GST uploaded', 'portalGst'], ['GST diff', 'gstDiff']].map(([title, key]) => <div key={key}><small>{title}</small><strong>{metric(field.totals[key])}</strong></div>)}</div><div className="ar-table-scroll ar-category-summary"><table className="ar-table"><thead><tr><th rowSpan={2}>Category</th><th colSpan={6} className="ar-registered-heading">REGISTERED</th><th colSpan={6} className="ar-unregistered-heading">UNREGISTERED</th></tr><tr>{['Registered', 'Unregistered'].flatMap(type => ['Base Qty', 'Portal Qty', 'Qty Diff', 'Base GST', 'Portal GST', 'GST Diff'].map(title => <th key={`${type}:${title}`} className={type === 'Registered' ? 'ar-registered-heading' : 'ar-unregistered-heading'}>{title}</th>))}</tr></thead><tbody>{['Cat-I', 'Cat-II', 'Cat-III', 'Cat-IV'].map(category => <tr key={category}><td>{category}</td>{['Registered', 'Unregistered'].flatMap(type => ['baseQty', 'portalQty', 'qtyDiff', 'baseGst', 'portalGst', 'gstDiff'].map(key => <td key={`${type}:${key}`} className={type === 'Registered' ? 'ar-registered-cell' : 'ar-unregistered-cell'}>{metric(field.categories[category]?.[type]?.[key])}</td>))}</tr>)}</tbody></table></div></>;
  }
  return <ReadonlyValue value={field.url ? {
    name: field.value,
    url: field.url
  } : field.value} />;
}
