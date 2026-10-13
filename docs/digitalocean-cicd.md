# DigitalOcean CI/CD

Production is deployed from the `main` branch to the DigitalOcean Droplet after the
DigitalOcean workflow's release verification job completes successfully.

## Production layout

- Repository: `/var/www/CRMANANTTATTVA`
- Branch: `main`
- Frontend: `/var/www/CRMANANTTATTVA/frontend/dist`
- Backend: `http://127.0.0.1:4000`
- PM2 process: `crm-backend`
- Public URL: `https://crmananttattva.com`

The deployment script refuses to overwrite tracked server changes. GitHub Actions
builds the frontend with a 4 GB Node heap,
packages `frontend/dist`, and transfers that verified artifact over SSH. The Droplet
only extracts the pre-built files into a temporary directory and atomically swaps
that directory into the Nginx document root. It never installs frontend dependencies
or runs the Vite build on the 2 GB server.

The workflow also transfers the deployment driver from its own checked-out release.
It does not execute whichever deployment script happens to be present in the
Droplet's current worktree, so a server already left in detached-HEAD mode remains
safe and deployable.

## Required GitHub Actions secrets

Create these under **Repository Settings > Secrets and variables > Actions**:

| Secret | Value |
| --- | --- |
| `DO_HOST` | Droplet public IPv4 address |
| `DO_USER` | SSH user; currently `root` |
| `DO_PORT` | SSH port; normally `22` |
| `DO_SSH_PRIVATE_KEY` | Dedicated deployment private key |
| `DO_SSH_KNOWN_HOSTS` | Trusted `known_hosts` entry for the Droplet |

Never commit or paste the private key into an issue, log, source file, or chat.

## Optional GitHub Actions variables

Create these under the **Variables** tab. Defaults match the current production
server, but explicit variables make future changes easier.

| Variable | Current value |
| --- | --- |
| `DO_APP_DIR` | `/var/www/CRMANANTTATTVA` |
| `DO_PM2_APP_NAME` | `crm-backend` |
| `DO_PUBLIC_URL` | `https://crmananttattva.com` |

## One-time SSH key setup

Generate a dedicated key on a trusted administrator machine:

```bash
ssh-keygen -t ed25519 -C "github-actions-crm-production" -f crm_do_deploy
```

Add the content of `crm_do_deploy.pub` as one line in the deployment user's
`~/.ssh/authorized_keys` file on the Droplet. Put the complete content of
`crm_do_deploy` into the `DO_SSH_PRIVATE_KEY` GitHub secret.

From the same trusted machine, record the Droplet host key and compare its
fingerprint with `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` on the Droplet:

```bash
ssh-keyscan -H -p 22 YOUR_DROPLET_IP
```

After verifying the fingerprint, put the `ssh-keyscan` output into the
`DO_SSH_KNOWN_HOSTS` secret.

## Deployment flow

1. Push a commit to `main`.
2. `DigitalOcean Deploy` installs locked dependencies, checks every backend source
   file, runs the paginated directory API tests, and builds the complete frontend on
   the GitHub-hosted runner with `NODE_OPTIONS=--max-old-space-size=4096`.
3. Production deployment starts only after those required checks succeed.
4. The workflow packages `frontend/dist`, stores it as a short-lived Actions
   artifact, and securely copies the archive to `/tmp` on the Droplet.
5. The server verifies the archive checksum and extracts it beside the live
   `/var/www/CRMANANTTATTVA/frontend/dist` directory. The existing `dist` remains
   live until the new artifact has passed validation.
6. The server verifies that the workflow's exact commit exists and checks out that
   SHA in detached-HEAD mode. It does not require `origin/main` to still point to the
   same commit. If files under `backend/` changed, it restarts `crm-backend`.
   Production dependencies are installed only when the backend package manifest or
   lockfile changed; frontend-only deployments do not restart PM2.
7. The frontend directories are swapped atomically, PM2 and the local backend health
   endpoint are checked, Nginx is validated, and both the public API and frontend
   must return a successful response.

If any post-swap check fails, the previous `dist` directory is restored. The Git
worktree is reset to the previous commit, previous backend dependencies are restored
when necessary, and PM2 is restarted back onto the previous backend only if the new
backend had already touched PM2. Ignored `.env` files are never removed or replaced.

The workflow can also be re-run manually from **GitHub > Actions > DigitalOcean
Deploy > Run workflow**.

The repository's broader `CI` workflow remains separate and continues reporting the
full legacy test suite. Some older source-text UI assertions currently fail against
the existing application, so they are not used as the production deployment trigger
until those tests are updated to the current UI behavior.

## Operational checks

```bash
cd /var/www/CRMANANTTATTVA
git log -1 --oneline
pm2 status
curl --fail http://127.0.0.1:4000/api/health
curl --fail https://crmananttattva.com/api/health
curl --fail https://crmananttattva.com/
sudo nginx -t
```

For stronger isolation, migrate the application and PM2 process from `root` to a
dedicated `deploy` user later. The first workflow intentionally matches the current
server ownership so deployment can be introduced without changing production process
ownership at the same time.

## Redis cache

See [Redis cache setup](redis-cache-digitalocean.md) for the local Droplet or Managed
Valkey setup, immediate write invalidation, browser refresh, health checks and rollback.
Redis credentials belong in backend `.env` on the server; the deployment preserves it.
