export function gatewayRetryDelay(error) {
  const config = error?.config;
  if (!config || String(config.method || 'get').toLowerCase() !== 'get' || config.signal?.aborted || error.code === 'ERR_CANCELED') return null;
  if (![502, 503, 504].includes(error.response?.status)) return null;
  return [1000, 2500, 5000][config._crmGatewayRetries || 0] ?? null;
}
