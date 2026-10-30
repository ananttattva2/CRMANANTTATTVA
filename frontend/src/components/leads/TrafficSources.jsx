import React from 'react';
import { ArrowUpRight, Radio, Users } from 'lucide-react';
export default function TrafficSources({ sources, total, onSelect, optionsUnavailable }) {
  return <aside className="traffic-sources" aria-labelledby="traffic-source-heading">
    <header><span className="traffic-source-icon"><Radio size={22}/></span><div><p>CLIENT ACQUISITION</p><h2 id="traffic-source-heading">Traffic Source</h2></div><span className="traffic-source-total">{total}</span></header>
    <p className="traffic-source-intro">Client Communication Mode <span>Click a source to explore its clients</span></p>
    <div className="traffic-source-list">{sources.map((source, index) => <button type="button" key={source.key} onClick={() => onSelect(source)} aria-label={`${source.label}: ${source.count} clients`} className={source.count ? '' : 'traffic-source-zero'} style={{ '--source-hue': [164, 24, 215, 270, 190, 330][index % 6] }}>
      <span className="traffic-source-row"><span className="traffic-source-dot"/><strong>{source.label}</strong><b>{source.count.toLocaleString('en-IN')}</b><ArrowUpRight size={14}/></span>
      <span className="traffic-source-bar"><span style={{ width: `${source.percentage}%` }}/></span><small>{source.percentage.toFixed(1)}% of visible unique leads</small>
    </button>)}</div>
    <footer><Users size={15}/><span>One source per unique lead. Unrecorded modes appear under Other / Not specified.</span></footer>
    {optionsUnavailable && <p role="status" className="traffic-source-warning">Custom dropdown options could not be refreshed. Saved source counts are still shown.</p>}
  </aside>;
}
