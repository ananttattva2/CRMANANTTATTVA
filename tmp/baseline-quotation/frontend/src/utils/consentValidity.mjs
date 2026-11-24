export function consentValidity(value, now = new Date()) {
  const key = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return { tone:'missing', label:'Validity date not recorded' };
  const expiry = new Date(`${key}T00:00:00Z`);
  if (!Number.isFinite(expiry.getTime()) || expiry.toISOString().slice(0,10) !== key) return { tone:'missing', label:'Check validity date' };
  const today = new Date(new Date(now.getTime()+330*60000).toISOString().slice(0,10)+'T00:00:00Z');
  const days = Math.round((expiry-today)/86400000);
  if (days < 0) return { tone:'expired', label:`Expired ${Math.abs(days)} days ago` };
  const threshold = new Date(expiry), day = threshold.getUTCDate();
  threshold.setUTCDate(1); threshold.setUTCMonth(threshold.getUTCMonth()-2);
  threshold.setUTCDate(Math.min(day,new Date(Date.UTC(threshold.getUTCFullYear(),threshold.getUTCMonth()+1,0)).getUTCDate()));
  return { tone:today >= threshold ? 'due' : 'active', label:days === 0 ? 'Expires today' : `${days} days remaining` };
}
