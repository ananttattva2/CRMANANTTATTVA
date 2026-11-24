import React, { useState } from 'react';
import { brand } from '../constants/brand';

const serviceLabels = [
  'Waste Advisory',
  'Risk Management',
  'CSR',
  'ESG',
  'EPR Credits'
];

function LoaderRing() {
  return (
    <svg className="crm-loader-ring" width={240} height={240} viewBox="0 0 240 240" aria-hidden="true">
      <circle className="crm-loader-ring__path crm-loader-ring__path--a" cx={120} cy={120} r={105} fill="none" strokeWidth={20} strokeDasharray="0 660" strokeDashoffset={-330} strokeLinecap="round" />
      <circle className="crm-loader-ring__path crm-loader-ring__path--b" cx={120} cy={120} r={35} fill="none" strokeWidth={20} strokeDasharray="0 220" strokeDashoffset={-110} strokeLinecap="round" />
      <circle className="crm-loader-ring__path crm-loader-ring__path--c" cx={85} cy={120} r={70} fill="none" strokeWidth={20} strokeDasharray="0 440" strokeLinecap="round" />
      <circle className="crm-loader-ring__path crm-loader-ring__path--d" cx={155} cy={120} r={70} fill="none" strokeWidth={20} strokeDasharray="0 440" strokeLinecap="round" />
    </svg>
  );
}

function CommandLoader({ message, dismissAfterMs = 0 }) {
  return (
    <div
      className={`brand-loader brand-loader-workspace ${dismissAfterMs ? 'brand-loader-dismiss' : ''}`}
      role="status"
      aria-live="polite"
      aria-label={message}
      style={dismissAfterMs ? { '--loader-dismiss-delay': `${dismissAfterMs}ms` } : undefined}
    >
      <div className="brand-loader-grid" />
      <div className="workspace-loader-panel">
        <div className="workspace-loader-logo">
          <img src={brand.logoUrl} alt={brand.name} />
        </div>
        <div className="workspace-loader-copy">
          <strong>{brand.name}</strong>
          <span>{message}</span>
        </div>
        <div className="workspace-loader-ring">
          <LoaderRing />
        </div>
      </div>
      <div className="workspace-loader-video" aria-hidden="true">
        <video autoPlay muted loop playsInline preload="auto">
          <source src="/video/crm_vid.mp4" type="video/mp4" />
        </video>
      </div>
      <div className="workspace-loader-services" aria-hidden="true">
        {serviceLabels.map((label) => <span key={label}>{label}</span>)}
      </div>
    </div>
  );
}

function CompactLoader({ message, dismissAfterMs = 0 }) {
  return (
    <div
      className={`brand-loader brand-loader-workspace brand-loader-compact ${dismissAfterMs ? 'brand-loader-dismiss' : ''}`}
      role="status"
      aria-live="polite"
      aria-label={message}
      style={dismissAfterMs ? { '--loader-dismiss-delay': `${dismissAfterMs}ms` } : undefined}
    >
      <div className="brand-loader-grid" />
      <div className="workspace-loader-panel">
        <div className="workspace-loader-logo">
          <img src={brand.logoUrl} alt={brand.name} />
        </div>
        <div className="workspace-loader-copy">
          <strong>{brand.name}</strong>
          <span>{message}</span>
        </div>
        <div className="workspace-loader-ring">
          <LoaderRing />
        </div>
      </div>
    </div>
  );
}

export default function BrandLoader({
  title = brand.name,
  eyebrow = 'Anant Tattva',
  subtitle = 'E-waste compliance intelligence',
  message = 'Preparing workspace',
  dismissAfterMs = 0
}) {
  const [showFullLoader] = useState(() => {
    if (typeof window === 'undefined') return true;
    try {
      const key = 'crm.brandLoader.fullShown';
      const token = window.localStorage.getItem('token');
      if (!token || token === 'undefined' || token === 'null') return false;
      const hasShown = window.sessionStorage.getItem(key) === '1';
      if (!hasShown) window.sessionStorage.setItem(key, '1');
      return !hasShown;
    } catch {
      return false;
    }
  });

  if (!showFullLoader) {
    return <CompactLoader message={message} />;
  }

  return <CommandLoader message={message} dismissAfterMs={dismissAfterMs} />;
}
