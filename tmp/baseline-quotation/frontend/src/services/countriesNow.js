const STATES_URL = 'https://countriesnow.space/api/v0.1/countries/states';
const CITIES_URL = 'https://countriesnow.space/api/v0.1/countries/state/cities';
const COUNTRY = 'India';

let statesCache = null;
const citiesCache = new Map();

function uniqueSorted(values = []) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

export async function fetchIndiaStates() {
  if (statesCache) return statesCache;
  const response = await fetch(STATES_URL, { headers: { Accept: 'application/json' } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.error) throw new Error(payload?.msg || 'Unable to load states.');
  const india = (Array.isArray(payload?.data) ? payload.data : []).find((item) => String(item?.name || '').toLowerCase() === COUNTRY.toLowerCase());
  statesCache = uniqueSorted((india?.states || []).map((item) => typeof item === 'string' ? item : item?.name));
  if (!statesCache.length) throw new Error('No Indian states were returned.');
  return statesCache;
}

export async function fetchIndiaStateCities(state) {
  const key = String(state || '').trim();
  if (!key) return [];
  if (citiesCache.has(key)) return citiesCache.get(key);
  const response = await fetch(CITIES_URL, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ country: COUNTRY, state: key })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.error) throw new Error(payload?.msg || `Unable to load cities for ${key}.`);
  const cities = uniqueSorted(Array.isArray(payload?.data) ? payload.data : []);
  citiesCache.set(key, cities);
  return cities;
}

export const countriesNowConfig = { country: COUNTRY, statesUrl: STATES_URL, citiesUrl: CITIES_URL };
