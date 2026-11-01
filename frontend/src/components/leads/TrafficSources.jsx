import React, { useState } from 'react';
import {
  ArrowUpRight, BriefcaseBusiness, CalendarDays, ChevronDown, Compass,
  Globe2, Handshake, Landmark, Megaphone, Network, PhoneCall, RefreshCw,
  Share2, Users
} from 'lucide-react';

const PARENT_ICONS = {
  'Digital Marketing': Megaphone, 'Social Media': Share2,
  'Direct Marketing': PhoneCall, 'Reference & Referral': Handshake,
  'Industry Events': CalendarDays, 'Business Development': BriefcaseBusiness,
  'Existing Client': RefreshCw, 'Tender & Procurement': Landmark,
  'Online Business Platforms': Globe2, 'Other Sources': Compass,
  'Other / Unmapped': Compass
};
const HUES = [164, 215, 24, 270, 190, 330, 145, 42, 205, 290, 0];

export default function TrafficSources({ sources, total, onSelect, optionsUnavailable }) {
  const [expanded, setExpanded] = useState(() => new Set());
  const active = [...sources].filter((source) => source.count > 0).sort((a, b) => b.count - a.count);
  const leading = active.slice(0, 5);
  function toggle(key) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }
  return <aside className="traffic-sources" aria-labelledby="traffic-source-heading">
    <header><span className="traffic-source-icon"><Network size={21}/></span><div><p>CLIENT ACQUISITION</p><h2 id="traffic-source-heading">Traffic Source</h2></div><span className="traffic-source-total">{total.toLocaleString('en-IN')}</span></header>
    <section className="traffic-source-insight" aria-label="Traffic source infographic">
      <div className="traffic-source-ring" style={{ '--active-share': `${sources.length ? active.length / sources.length * 100 : 0}%` }}><strong>{active.length}</strong><span>active<br/>parents</span></div>
      <div className="traffic-source-mix"><strong>Acquisition mix</strong><span>Parent categories across visible leads</span><div className="traffic-source-stack" aria-hidden="true">{leading.map((source) => <i key={source.key} style={{ width: `${source.percentage}%`, '--source-hue': HUES[sources.indexOf(source) % HUES.length] }}/>)}</div></div>
    </section>
    <p className="traffic-source-intro">Communication hierarchy <span>Expand a parent to view its sub-categories.</span></p>
    <div className="traffic-source-list">{sources.map((source, index) => {
      const isExpanded = expanded.has(source.key);
      const Icon = PARENT_ICONS[source.label] || Compass;
      return <article key={source.key} className={`${source.count ? '' : 'traffic-source-zero'} ${isExpanded ? 'is-expanded' : ''}`} style={{ '--source-hue': HUES[index % HUES.length] }}>
        <div className="traffic-source-parent">
          <button type="button" className="traffic-source-parent-main" onClick={() => toggle(source.key)} aria-expanded={isExpanded} aria-controls={`${source.key}-children`}>
            <span className="traffic-source-parent-icon"><Icon size={16}/></span><span className="traffic-source-parent-copy"><strong>{source.label}</strong><small>{source.percentage.toFixed(1)}% of visible leads</small></span><b>{source.count.toLocaleString('en-IN')}</b><ChevronDown size={16}/>
          </button>
          <button type="button" className="traffic-source-parent-view" onClick={() => onSelect(source)} aria-label={`View all ${source.label} clients`} disabled={!source.count}><ArrowUpRight size={15}/></button>
        </div>
        <span className="traffic-source-bar"><span style={{ width: `${source.percentage}%` }}/></span>
        {isExpanded && <div id={`${source.key}-children`} className="traffic-source-children">{source.children.map((child) => <button type="button" key={child.key} onClick={() => onSelect(child)} disabled={!child.count} aria-label={`${child.label}: ${child.count} clients`}><span className="traffic-source-child-dot"/><span><strong>{child.label}</strong><small>{child.percentage.toFixed(1)}%</small></span><b>{child.count.toLocaleString('en-IN')}</b><ArrowUpRight size={13}/></button>)}</div>}
      </article>;
    })}</div>
    <footer><Users size={15}/><span>Each unique lead is counted once. Expand a parent for the detailed source mix.</span></footer>
    {optionsUnavailable && <p role="status" className="traffic-source-warning">Custom dropdown options could not be refreshed. Saved source counts are still shown.</p>}
  </aside>;
}
