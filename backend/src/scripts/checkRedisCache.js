require('dotenv').config({ override: true });
const { createClient } = require('redis');
async function main() {
  if (!process.env.REDIS_URL) throw new Error('REDIS_URL is not configured in backend/.env');
  const client = createClient({ url: process.env.REDIS_URL, disableOfflineQueue: true,
    socket: { connectTimeout: 3000, reconnectStrategy: false } });
  client.on('error', () => {});
  try {
    await client.connect();
    const key = `${process.env.REDIS_CACHE_PREFIX || 'crm:production:v1'}:connection-test`;
    await client.set(key, 'ok', { EX: 10 });
    if (await client.get(key) !== 'ok') throw new Error('Redis GET/SET verification failed');
    const remaining = await client.ttl(key);
    if (remaining < 1 || remaining > 10) throw new Error('Redis TTL verification failed');
    await client.del(key);
    console.log('Redis PING:', await client.ping(), '| GET/SET/TTL connection test passed.');
  } finally { if (client.isOpen) client.destroy(); }
}
main().catch(error => {
  console.error('Redis cache check failed:', error.code || error.name, 'Check REDIS_URL, password, network and TLS.');
  process.exitCode = 1;
});
