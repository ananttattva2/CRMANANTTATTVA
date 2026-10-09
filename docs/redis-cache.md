# Optional Redis / DigitalOcean Valkey cache

Redis is optional. With `REDIS_CACHE_ENABLED` unset/false, or no `REDIS_URL`,
the existing bounded memory caches operate as before. MongoDB remains the source
of truth. No DigitalOcean resource is created by this code.

## Cached reads

The shared cache covers assignment dashboards, Overall Dashboard records,
assignment reviews, and user productivity reports. Dashboard TTL is 15 seconds;
productivity TTL is 60 seconds. It does not cache every API endpoint or approval
action. Authorization still runs before dashboard access; report keys include
requester ID, role, and date range. Filter/scope keys are hashed, namespaced and
versioned. JSON responses larger than 2 MiB bypass Redis storage.

Successful data and user/team mutations invalidate these read caches before
their JSON response is sent. Failed requests and activity heartbeats do not
invalidate them. Background updates and writes performed directly in MongoDB
become visible when the TTL expires. Ordinary writes through another application
must invalidate the same Redis version or wait for expiry.

Invalidation changes a shared version; old entries expire naturally without
`KEYS` or `FLUSHDB`. A Lua comparison prevents a database load begun before an
edit from storing its stale result under the current version. Reads coalesce
within each Node worker, not across workers. Redis hits deserialize Dates as ISO
strings, matching the public JSON API representation.

## DigitalOcean setup (after code deployment)

1. Create a Managed Valkey cluster in the backend Droplet's region/VPC.
2. Add the backend Droplet to the cluster's Trusted Sources.
3. Obtain the private connection URL and CA certificate from Connection Details.
4. Save the CA on the server, for example `/etc/crm/valkey-ca.crt`, readable by
   the backend process. Keep certificate verification enabled.
5. Append these variables to the existing backend `.env` (never commit credentials):

   ```dotenv
   REDIS_CACHE_ENABLED=true
   REDIS_URL=rediss://USERNAME:URL_ENCODED_PASSWORD@PRIVATE_HOST:PORT
   REDIS_CACHE_PREFIX=crm:production:read-cache:v1
   REDIS_CA_PATH=/etc/crm/valkey-ca.crt
   ```

   Use distinct prefixes for production, staging and different apps. Use the
   actual DigitalOcean URL; do not paste placeholder values unchanged. Preserve
   all MongoDB and auth configuration. `.env.redis.example` documents optional
   settings; it is not a replacement environment file.
6. In `/var/www/CRMANANTTATTVA/backend`, run `npm run cache:check`.
7. Restart the existing backend with `pm2 restart crm-backend --update-env`.
8. `/api/health` includes `cache.enabled`, `cache.ready`, and an error count;
   it never exposes the cache host, password, keys or cached records.

Test a dashboard twice, edit a related record, verify the updated result, and
verify manager/staff visibility separately. Monitor API response latency and
database load; no fixed page-speed improvement is guaranteed.

## Failure behavior and rollback

Connections happen in the background, with a 1.5-second socket connect timeout
and a two-second overall connect/handshake deadline. Redis
command attempts are bounded to 750 ms per operation; offline commands are not
queued. Failed connections retry on a later cache request after a ten-second
cooldown. When Redis is configured but unavailable, reads query MongoDB rather
than reuse local cached results that another worker could have invalidated.
Reconnection rotates the shared version before serving hits. During network
partitions, other connected workers may retain cached data until expiry if an
invalidation cannot reach Redis. Redis is a performance layer, not a financial
or authorization source of truth.

Set `REDIS_CACHE_ENABLED=false` and restart PM2 to return to memory caching.
MongoDB data is unaffected; no Redis deletion or data migration is required.

References: [DigitalOcean connection setup](https://docs.digitalocean.com/products/databases/valkey/how-to/connect/),
[Redis Node connection/TLS](https://redis.io/docs/latest/develop/clients/nodejs/connect/).
