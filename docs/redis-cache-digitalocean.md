# CRM Redis cache: DigitalOcean setup

The code is ready; Redis must still be installed/configured on the server. These
instructions match the existing production layout in `digitalocean-cicd.md`:
Ubuntu 24.04, a 2 GB Droplet, `/var/www/CRMANANTTATTVA`, and PM2 `crm-backend`.
They do not change MongoDB Atlas or migrate CRM data into Redis.

## What is cached and how freshness works

Authenticated JSON reads used by Dashboard, Overall Dashboard, Operations
Dashboard, Sales Dashboard, Super Admin Dashboard, Sales Management MIS,
Complete MIS, Client Daily MIS, Lead Open/Close, and View Quotations are cached.
Supporting user/team, calendar, annual-return and approval reads are included.

- Default TTL: 60 seconds. This is expiration, not a requirement to wait 60 seconds.
- Successful model writes and HTTP mutations change a shared MongoDB revision
  before the write response is acknowledged. Old Redis entries become unreachable.
  Scheduled model saves, updates and deletes also invalidate the revision.
- Example: count 10 is cached; a new lead is saved; the next fetch sees count 11.
  An old read overlapping that write cannot populate the new cache generation.
- Authentication and role/guard checks run before every cache lookup. Each user's
  current permissions and each filter/page belong to separate cache keys.
- Same-browser successful writes trigger page refresh immediately. Other open
  visible browsers detect a revision change on a shared 5-second poll, then fetch
  fresh data. This is normally within 5 seconds **plus request/computation time**,
  not a promise of instantaneous cross-browser delivery. Hidden tabs refresh on
  return. Reports also refresh every 60 seconds for time-dependent telemetry.
- Form editing is not auto-refreshed. Lead/quotation list pages retain their
  current filters and page when refreshed.
- No browser/proxy response cache; server response headers use `private, no-store`.
- Redis unavailable/slow: read directly from MongoDB. No offline Redis command
  queue; commands have a bounded wait and retries use backoff. Cache failures do
  not reject a successful CRM write.
- Revision lookup unavailable: bypass cache. A failed revision update disables
  that worker's Redis connection; inspect MongoDB and restart that worker after
  recovery. This is not a database transaction across the CRM write and revision
  update. During a revision-write failure, other workers may retain their previous
  generation until TTL; investigate/restart all workers before resuming caching.
- Direct MongoDB Compass edits, independent external writers and scripts that do
  not import the application's invalidation plugin are outside the immediate
  invalidation contract. After maintenance changes run `npm run cache:invalidate`.
  Without that command, they appear after TTL. Integrations through CRM APIs are
  covered automatically.

Redis speeds up repeat reads. The first read for a user/filter after expiration
or invalidation still calculates the MongoDB result. Large payload transfer,
frontend rendering and slow database queries can still limit page speed. Responses
over 8 MiB and failed responses are not cached. The revision is stored in the
`crm_cache_revisions` collection, so Redis eviction/restart does not erase it.

## Option A: Redis on the same Droplet

This is a reasonable starting configuration for the existing 2 GB server. Start
with **128 MB maxmemory**, then monitor total RAM. Redis process overhead is in
addition to maxmemory. No new DigitalOcean database needs to be created.

1. Open **Droplets → your Droplet → Web Console**, or SSH to the server.

2. Install the Ubuntu-packaged Redis server:

   ```bash
   sudo apt update
   sudo apt install -y redis-server
   redis-server --version
   ```

3. Generate a password:

   ```bash
   openssl rand -hex 32
   ```

   Keep the value privately; use the same value in Redis config and backend `.env`.
   Hex characters need no URL encoding. Do not put the real password in GitHub.

4. Back up and edit the config:

   ```bash
   sudo cp /etc/redis/redis.conf /etc/redis/redis.conf.before-crm-cache
   sudo nano /etc/redis/redis.conf
   ```

   Set these directives **once**, replacing any existing directives with the same
   name. This config is for a dedicated cache; if Redis is already used for queues
   or durable application data, use a separate instance instead.

   ```conf
   bind 127.0.0.1 ::1
   protected-mode yes
   port 6379
   maxmemory 128mb
   maxmemory-policy allkeys-lru
   requirepass YOUR_GENERATED_HEX_PASSWORD
   appendonly no
   save ""
   ```

   Remove/comment any other active `save` lines. Cache entries are rebuildable;
   MongoDB remains the source of truth.

5. Enable/restart and verify the service:

   ```bash
   sudo systemctl enable redis-server
   sudo systemctl restart redis-server
   sudo systemctl status redis-server --no-pager
   sudo ss -ltnp | grep ':6379'
   ```

   The listener must be loopback (`127.0.0.1`/`::1`), not a public IP or `0.0.0.0`.
   In **DigitalOcean → Networking → Firewalls**, do not add an inbound rule for
   TCP 6379. Keep existing SSH/HTTP/HTTPS rules. Local Redis needs no DNS change,
   VPC change, GitHub secret, or MongoDB Atlas allowlist change.

6. Configure the backend:

   ```bash
   cd /var/www/CRMANANTTATTVA/backend
   nano .env
   ```

   Add/update (keep the existing MongoDB, JWT and other settings):

   ```dotenv
   REDIS_URL=redis://default:YOUR_GENERATED_HEX_PASSWORD@127.0.0.1:6379/0
   REDIS_CACHE_ENABLED=true
   REDIS_CACHE_PREFIX=crm:production:v1
   REDIS_CACHE_TTL_SECONDS=60
   REDIS_CACHE_TIMEOUT_MS=200
   ```

   All production workers must use the same Redis URL and prefix. Staging and
   another CRM database must use a different prefix. `.env.redis.example` is a
   template only; the running app reads `.env`.

7. Wait for this release's **GitHub → Actions → DigitalOcean Deploy** workflow
   to succeed. It installs the locked backend dependency and publishes the
   frontend artifact. The Droplet should not run a frontend build. Then:

   ```bash
   cd /var/www/CRMANANTTATTVA/backend
   npm run cache:check
   pm2 restart crm-backend --update-env
   pm2 save
   curl --fail http://127.0.0.1:4000/api/health
   ```

   Expect `Redis PING: PONG`, a passed GET/SET connection test, and health
   `cache.enabled: true`, `cache.state: "connected"`, `cache.ttlSeconds: 60`.
   The app can serve traffic without Redis while you finish setup; health still
   checks the CRM database independently.

## Verify in the actual CRM

1. Refresh the deployed browser page so the new frontend runs.
2. In DevTools → Network, open the page twice with identical filters. For cached
   APIs expect `X-CRM-Cache: MISS` then `HIT`. An explicit `Cache-Control: no-cache`
   request forces a fresh read; DevTools "Disable cache" can therefore prevent HIT.
3. Warm a dashboard showing 10 leads. In a second tab/browser create a lead visible
   to that dashboard's user/filter. The next fetch must show 11 before 60 seconds.
   Verify the current visible dashboard auto-refreshes on the 5-second revision
   check. Test update, delete, open/close, quotation approval and client status too.
4. Verify different user roles cannot see each other's lead/quotation data.

For private operational checks (enter the password silently):

```bash
read -r -s -p 'Redis password: ' REDISCLI_AUTH; echo
export REDISCLI_AUTH
redis-cli PING
redis-cli INFO memory
redis-cli INFO stats
unset REDISCLI_AUTH
free -h
pm2 status
```

`keyspace_hits` should increase as repeat reads occur. Monitor memory/evictions
and response times before changing the 128 MB budget. Do not use `FLUSHALL` on a
shared Redis instance.

## Option B: DigitalOcean Managed Valkey

DigitalOcean now provides Managed Valkey, a Redis-compatible service. Use this
alternative when you want Redis off the small app Droplet and accept a separate
paid database resource.

1. Create a **Valkey** managed database in the app's region/VPC.
2. Add this Droplet under the database's **Trusted Sources**.
3. Copy the **private connection URL** from **Connection Details**.
4. Put that full URL in backend `.env` as `REDIS_URL`; use the TLS `rediss://`
   scheme, the supplied username/password/port, and URL-encode credentials if
   composing the URL manually. Do not disable certificate verification.
5. Set the cache eviction policy to `allkeys-lru` for a dedicated cache database.
6. Use the same remaining backend settings, run `npm run cache:check`, restart PM2,
   and verify health/HIT/fresh-count behavior as above. Skip local Redis installation.

Do not expose a local Redis port to make it reachable by another app server; use
the managed private endpoint or a separately secured private Redis setup instead.

## Troubleshooting and disable switch

- `disabled`: `.env` settings are missing, or `REDIS_CACHE_ENABLED=false`.
- `unavailable`: check service, password, private network/trusted sources and TLS.
  MongoDB reads continue; inspect `pm2 logs crm-backend --lines 50` privately.
- `disabled-after-invalidation-error`: verify MongoDB revision writes and restart
  **all** app workers after recovery. Do not assume the saved data was rolled back.
- Only MISS: first read, changed filters/user permissions/revision, request asks
  for no-cache, payload over 8 MiB, Redis unavailable, or cache pressure/evictions.
- After direct database maintenance:

  ```bash
  cd /var/www/CRMANANTTATTVA/backend
  npm run cache:invalidate
  ```

- To disable Redis caching: set `REDIS_CACHE_ENABLED=false` in backend `.env`, then
  `pm2 restart crm-backend --update-env`. CRM will read MongoDB directly.

## Sources and validation

- [Redis installation](https://redis.io/docs/latest/operate/oss_and_stack/install/install-stack/apt/)
- [Redis eviction policy](https://redis.io/docs/latest/reference/eviction/)
- [Node Redis production usage](https://redis.io/docs/latest/develop/clients/nodejs/produsage/)
- [DigitalOcean Valkey connection/TLS](https://docs.digitalocean.com/products/databases/valkey/how-to/connect/)
- [DigitalOcean Valkey trusted sources](https://docs.digitalocean.com/products/databases/valkey/how-to/secure/)

Run `npm run test:cache` in backend for revision/TTL isolation, concurrent-write,
HTTP authentication, mutation acknowledgement and browser refresh tests. These
tests use an injected cache/revision store and local HTTP fixture; they do not
claim verification against your live Redis, Atlas or production server. Perform
the server checks above after setup. Cache tests also gate DigitalOcean releases.

## Dashboard and directory performance update

The following page APIs use authenticated Redis response caching:

| Page/tab | Main API |
| --- | --- |
| Purchase & Sales tab in Overall Dashboard | `/api/dashboard-insights/upload-tracker?financialYear=...&serviceType=...` |
| PO tab | `/api/dashboard-insights/purchase-orders?view=monthly` |
| Sidebar Lead Open / Lead Close | `/api/leads?view=review` and `/api/quotations?view=lead-review&compact=true` |
| Sales Lead Generation directory | `/api/leads?paginated=true&directory=true&...` |
| Pending client/quotation approvals | `/api/clients/pending-approvals` |
| PO/special/service approval feed | `/api/leads/duplicate-approvals` |
| Deactivation approvals | `/api/clients/deactivation-requests` |

Related dashboard tabs now share revision-aware Redis read models. Concurrent
requests for the same snapshot/revision share one loader. Changes still move every
read to a new revision; in-flight old snapshots cannot populate the new generation.
BSON IDs and dates survive cache serialization. Redis outages still use MongoDB.

Cold dashboard reads batch linked Leads instead of doing a correlated lookup for
every Client. Monthly PO reads discard Leads without PO evidence before loading
related quotations. Lead directory responses include compact owner/service/PO
status fields, not embedded proof files or full quotation items. View/Edit and
exports still retrieve the full records. Lead lists start auth/staff/page reads in
parallel and defer quotations/form catalogs until a form or detail is opened.
Pending Approval starts its special/PO feed alongside primary reads, updates its
visible lists immediately when primary data arrives, and refreshes after writes
without resetting pagination. Repeated legacy-notification checks do not rewrite
unchanged service approvals and invalidate the whole cache.

Authentication executes once within a nested Express route, while every new HTTP
request still verifies the JWT and reads the current active user. Response timing
headers include `auth` and `cache` so slow warm requests can be investigated.

No new Redis settings or manual restart are required if DigitalOcean Deploy succeeds;
that workflow restarts the changed backend and creates the new non-unique read
indexes on startup. Confirm the deployed release using `/api/health`, then refresh
the browser. For each API compare two identical requests within 60 seconds and no
intervening write. Expect a warm `HIT`. Check `Time`/`Server-Timing` and verify a
relevant data change appears on the next fetch. These changes reduce work; actual
production latency must be measured after deployment, not inferred from unit tests.

Lead Open/Close month-end snapshots prepare each service timeline once and each
month boundary once, preserving historical membership. Their price column uses a
quotation projection containing only match IDs, dates and amounts, without full
quotation items/approval documents or unused user populations. These pages also
participate in write-driven live refresh.

## Follow-up: slow pages despite a Redis HIT

A HIT describes one API request. It does not measure another request, browser
queueing, downloading, or rendering. In the reported captures, the quotation
price request was fast while `/leads?view=review` took about eight seconds;
dashboard directory pages also took several seconds each.

Dashboard collection reads now use `dashboard=true&paginated=true&snapshot=true`.
This preserves the complete scoped dataset and exclusions, but reads it once
instead of fetching every 100-record directory page and its count/summary.
Ordinary directory pagination is unchanged. Snapshot loaders and compact lead
review/editor reads share only within the current revision. Editor reads omit
embedded lead proof bytes; normal detail/export routes keep their original data.
View Quotations renders independently of lead/editor references. MIS background
refreshes keep existing tables visible. Complete MIS, Super Admin and Sales
Management can share identical admin productivity reads; each manager's report
has a separate cache scope. Dashboard user-directory reads also share within a
revision. CRM writes still invalidate reads.

Additional non-unique client, quotation, session and audit indexes are ensured
by the normal backend startup. No Redis password, port or TTL change is required.

After the GitHub DigitalOcean deployment succeeds, run in the Droplet console:

```bash
cd /var/www/CRMANANTTATTVA/backend
npm run cache:check
npm run performance:check
curl --fail http://127.0.0.1:4000/api/health
pm2 logs crm-backend --lines 40 --nostream
free -h
vmstat 1 5
```

`performance:check` is read-only and prints MongoDB round trips plus bounded
100-record sort query plans. It never prints credentials or CRM records. It
diagnoses baseline database reads, not the complete authenticated page flow.
An error prints its name/code only. Share these diagnostics without `.env`,
authorization headers, or connection strings. Deployment restarts PM2 already;
there is no need to restart Redis or rebuild the frontend on the Droplet.

Hard-refresh the browser once. Check the slowest Fetch/XHR request's **Timing**
tab as well as its own `X-CRM-Cache` and `Server-Timing`. High Queueing points to
browser/connection contention; high Waiting with `query` timing points to a cold
database read. Measure twice within the TTL without a CRM change, then verify a
new record appears after a write. A HIT is evidence of caching, not proof that
all pages are fast.

Do not buy a larger Droplet solely because pages are slow. If these measurements
show sustained CPU saturation or memory pressure, consider a 2-vCPU/4-GB plan.
Use CPU/RAM-only resizing to retain disk-size flexibility, schedule the downtime,
and follow DigitalOcean's snapshot/shutdown/resize/start instructions:
https://docs.digitalocean.com/products/droplets/how-to/resize/
If MongoDB round trips are high, inspect the Atlas cluster region/tier and its
query diagnostics; increasing Droplet RAM alone does not resolve database latency.

## Follow-up after healthy server diagnostics

The reported production checks showed Mongo round trips of 17–21 ms, indexed
sample reads without blocking sorts, connected Redis and ample idle CPU/RAM.
These samples do not measure full report payloads. No Droplet resize or Redis
configuration change is indicated by those results.

The Pending Approval PO feed now requests `listOnly=true`: saved amounts and
statuses render without loading all related leads, quotations and proof bytes.
Legacy records with incomplete amount snapshots retain the recovery path. Use
**View PO Proofs** to load the existing authenticated PO detail endpoint; stored
proofs and approve/reject workflows remain available there. Inline proof bytes
are excluded from list responses so large uploads do not exceed the cache limit.
The endpoint reports separate `approvals` and `enrichment` timings on a MISS.

Super Admin/Complete MIS completion-count queries now compact long embedded
strings into presence markers inside MongoDB, before data crosses the network.
The projection preserves keys, nested arrays, scalar types and completion counts.
Detailed work reports continue to fetch original documents. Operations Dashboard
Annual Return rows omit unused Client Master sections and no longer repeat all
filings inside each filing's client snapshot. Every filing/status/PO remains in
the response. Sales Dashboard skips operations-only compliance, Annual Return
and approval queries; changing dashboard mode triggers a guarded reload.

Heartbeat updates now compute elapsed time and append presence changes atomically
on the current session, avoiding the version conflict shown in the server logs.
This optional telemetry remains separate from CRM cache invalidation.

After the successful GitHub deployment, hard-refresh once and run:

```bash
cd /var/www/CRMANANTTATTVA/backend
npm run performance:check
curl --fail http://127.0.0.1:4000/api/health
```

The diagnostic now compares original and compact MIS byte sizes for a bounded
100-client sample without printing client records. Report its output and the
slowest page request's own Timing/Server-Timing if a delay remains. Synthetic
fixtures prove payload reduction and count preservation; live page latency
still needs verification after deployment.
