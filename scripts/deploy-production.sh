#!/usr/bin/env bash

set -Eeuo pipefail

EXPECTED_SHA="${1:?Expected Git commit SHA is required}"
PM2_APP_NAME="${2:-crm-backend}"
PUBLIC_URL="${3:-https://crmananttattva.com}"
FRONTEND_ARTIFACT="${4:?Frontend artifact path is required}"
FRONTEND_ARTIFACT_SHA256="${5:?Frontend artifact SHA-256 is required}"
DEPLOY_DRIVER_PATH="${6:-}"
ALLOW_SERVER_BUILD="${7:-false}"
SERVER_BUILD=false
APP_DIR="$(pwd -P)"
LOCK_FILE="/tmp/crmananttattva-production-deploy.lock"
PREVIOUS_SHA="$(git rev-parse HEAD)"
NEXT_DIST=""
BACKUP_DIST=""
FRONTEND_SWAPPED=false
HAD_PREVIOUS_DIST=false
CODE_UPDATED=false
BACKEND_CHANGED=false
BACKEND_DEPS_CHANGED=false
PM2_TOUCHED=false
SERVER_STASH_SHA=""

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "Another CRM deployment is already running."
  exit 1
fi

cleanup_build_directory() {
  if [[ -n "$NEXT_DIST" && -d "$NEXT_DIST" ]]; then
    rm -rf -- "$NEXT_DIST"
  fi
  if [[ -n "${FRONTEND_ARTIFACT:-}" && -f "$FRONTEND_ARTIFACT" ]]; then
    rm -f -- "$FRONTEND_ARTIFACT"
  fi
  if [[ "$DEPLOY_DRIVER_PATH" =~ ^/tmp/crm-deploy-[0-9]+-[0-9]+\.sh$ && -f "$DEPLOY_DRIVER_PATH" ]]; then
    rm -f -- "$DEPLOY_DRIVER_PATH"
  fi
}

rollback_deployment() {
  local exit_code=$?
  trap - ERR
  echo "Deployment failed; restoring the previous working release ${PREVIOUS_SHA:0:12}."

  if [[ "$FRONTEND_SWAPPED" == true ]]; then
    rm -rf -- "$APP_DIR/frontend/dist"
    if [[ "$HAD_PREVIOUS_DIST" == true && -n "$BACKUP_DIST" && -d "$BACKUP_DIST" ]]; then
      mv -- "$BACKUP_DIST" "$APP_DIR/frontend/dist"
    fi
  fi
  cleanup_build_directory

  if [[ "$CODE_UPDATED" == true ]]; then
    git checkout --detach "$PREVIOUS_SHA"
    if [[ "$BACKEND_DEPS_CHANGED" == true ]]; then
      npm ci --prefix backend --omit=dev || true
    fi
    if [[ "$PM2_TOUCHED" == true ]]; then
      DEPLOY_COMMIT="$PREVIOUS_SHA" pm2 restart "$PM2_APP_NAME" --update-env || true
    fi
  fi

  if [[ -n "$SERVER_STASH_SHA" ]]; then
    echo "Restoring pre-deployment tracked server changes from stash ${SERVER_STASH_SHA:0:12}."
    if ! git stash apply --index "$SERVER_STASH_SHA"; then
      echo "Automatic stash restore needs manual attention; the recovery stash was preserved: $SERVER_STASH_SHA"
    fi
  fi

  exit "$exit_code"
}

trap rollback_deployment ERR

if [[ "$(git rev-parse --is-inside-work-tree)" != "true" ]]; then
  echo "APP_DIR is not a Git worktree: $APP_DIR"
  exit 1
fi

if [[ ! "$EXPECTED_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Expected commit must be a full 40-character Git SHA."
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Tracked server files have local changes; preserving them before deployment."
  git status --short
  git stash push --message "production pre-deploy $(date -u +%Y-%m-%dT%H:%M:%SZ) ${EXPECTED_SHA:0:12}"
  SERVER_STASH_SHA="$(git rev-parse --verify refs/stash)"
  if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "Tracked server files could not be preserved cleanly. Deployment stopped."
    false
  fi
  echo "Tracked changes preserved in recovery stash ${SERVER_STASH_SHA:0:12}."
fi

git fetch --prune origin

if ! git cat-file -e "${EXPECTED_SHA}^{commit}" 2>/dev/null; then
  echo "Expected commit does not exist on the server: $EXPECTED_SHA"
  exit 1
fi

if [[ ! "$FRONTEND_ARTIFACT" =~ ^/tmp/crm-frontend-[0-9]+-[0-9]+\.tgz$ ]]; then
  echo "Frontend artifact must be a deployment archive in /tmp."
  exit 1
fi

if [[ ! -f "$FRONTEND_ARTIFACT" ]]; then
  if [[ "$ALLOW_SERVER_BUILD" != true ]] ||
     ! git diff --quiet "$PREVIOUS_SHA" "$EXPECTED_SHA" -- frontend/package.json frontend/package-lock.json ||
     [[ ! -x "$APP_DIR/frontend/node_modules/.bin/vite" ]]; then
    echo "Frontend artifact unavailable and matching local build dependencies were not found."
    exit 1
  fi
  SERVER_BUILD=true
  echo "Building the CI-verified commit with unchanged frontend dependencies on the server."
fi

NEXT_DIST="$(mktemp -d "$APP_DIR/frontend/.dist-next.XXXXXX")"
if [[ "$SERVER_BUILD" == false ]]; then
ACTUAL_ARTIFACT_SHA256="$(sha256sum "$FRONTEND_ARTIFACT" | awk '{print $1}')"
if [[ "$ACTUAL_ARTIFACT_SHA256" != "$FRONTEND_ARTIFACT_SHA256" ]]; then
  echo "Frontend artifact checksum verification failed."
  false
fi

tar --extract --gzip --file "$FRONTEND_ARTIFACT" --directory "$NEXT_DIST" --no-same-owner --no-same-permissions
test -s "$NEXT_DIST/index.html"
if [[ -n "$(find "$NEXT_DIST" -type l -print -quit)" ]]; then
  echo "Frontend artifact contains a symbolic link; deployment stopped."
  false
fi
fi

if ! git diff --quiet "$PREVIOUS_SHA" "$EXPECTED_SHA" -- backend; then
  BACKEND_CHANGED=true
fi
if ! git diff --quiet "$PREVIOUS_SHA" "$EXPECTED_SHA" -- backend/package.json backend/package-lock.json; then
  BACKEND_DEPS_CHANGED=true
fi

git checkout --detach "$EXPECTED_SHA"
CODE_UPDATED=true

if [[ "$(git rev-parse HEAD)" != "$EXPECTED_SHA" ]]; then
  echo "Production worktree did not switch to the requested commit."
  false
fi

if [[ "$SERVER_BUILD" == true ]]; then
  CRM_FRONTEND_OUT_DIR="$NEXT_DIST" NODE_OPTIONS=--max-old-space-size=2048 npm run build --prefix frontend
  test -s "$NEXT_DIST/index.html"
fi

# Fail before the release switch if index.html references an entry asset that
# is absent from the verified bundle. Returning the SPA fallback for a missing
# module would otherwise surface in browsers as a misleading MIME-type error.
mapfile -t FRONTEND_ENTRY_ASSETS < <(grep -oE '(src|href)="/assets/[^"?]+\.(js|css)' "$NEXT_DIST/index.html" | sed -E 's/^(src|href)="\///' | sort -u)
if (( ${#FRONTEND_ENTRY_ASSETS[@]} == 0 )); then
  echo "Frontend index does not reference a built JavaScript or CSS entry asset."
  false
fi
for asset in "${FRONTEND_ENTRY_ASSETS[@]}"; do
  if [[ ! -s "$NEXT_DIST/$asset" ]]; then
    echo "Frontend entry asset is missing from the release: $asset"
    false
  fi
done

# Browsers with an already-open CRM tab may request the previous release's
# lazy chunks after this switch. Keep recent content-hashed assets alongside
# the new release; --no-clobber guarantees that the verified release wins.
if [[ -d "$APP_DIR/frontend/dist/assets" ]]; then
  mkdir -p "$NEXT_DIST/assets"
  while IFS= read -r -d '' previous_asset; do
    cp --preserve=timestamps --no-clobber -- "$previous_asset" "$NEXT_DIST/assets/"
  done < <(find "$APP_DIR/frontend/dist/assets" -maxdepth 1 -type f -mtime -14 -print0)
fi

# mktemp creates a private directory; Nginx must be able to traverse the release root.
chmod 755 "$NEXT_DIST"

if [[ "$BACKEND_CHANGED" == true ]]; then
  if [[ "$BACKEND_DEPS_CHANGED" == true ]]; then
    npm ci --prefix backend --omit=dev
  fi
  node --check backend/src/index.js
fi

# Deliver personal access keys before enabling the license-first login UI.
# Later deployments keep existing keys and skip accepted emails.
if [[ -f backend/src/scripts/syncStaffLicenses.js ]]; then
  node backend/src/scripts/syncStaffLicenses.js
fi

BACKUP_DIST="$APP_DIR/frontend/.dist-previous-$(date +%s)"
if [[ -d "$APP_DIR/frontend/dist" ]]; then
  HAD_PREVIOUS_DIST=true
  mv -- "$APP_DIR/frontend/dist" "$BACKUP_DIST"
fi
mv -- "$NEXT_DIST" "$APP_DIR/frontend/dist"
NEXT_DIST=""
FRONTEND_SWAPPED=true

pm2 describe "$PM2_APP_NAME" >/dev/null
if [[ "$BACKEND_CHANGED" == true ]]; then
  PM2_TOUCHED=true
  DEPLOY_COMMIT="$EXPECTED_SHA" pm2 restart "$PM2_APP_NAME" --update-env
fi

for attempt in {1..12}; do
  if curl --fail --silent --show-error --max-time 10 http://127.0.0.1:4000/api/health >/dev/null; then
    break
  fi
  if [[ "$attempt" == 12 ]]; then
    echo "Backend health check did not recover after PM2 restart."
    false
  fi
  sleep 5
done

PM2_PID="$(pm2 pid "$PM2_APP_NAME" | tail -n 1)"
if [[ ! "$PM2_PID" =~ ^[1-9][0-9]*$ ]]; then
  echo "PM2 process $PM2_APP_NAME is not online."
  false
fi

nginx -t
systemctl reload nginx
curl --fail --silent --show-error --location --retry 5 --retry-delay 3 --retry-all-errors --max-time 20 "$PUBLIC_URL/api/health" >/dev/null
curl --fail --silent --show-error --location --retry 5 --retry-delay 3 --retry-all-errors --max-time 20 "$PUBLIC_URL/" >/dev/null
PUBLIC_ENTRY_ASSET="/${FRONTEND_ENTRY_ASSETS[0]}"
ENTRY_CONTENT_TYPE="$(curl --fail --silent --show-error --location --retry 5 --retry-delay 2 --retry-all-errors --max-time 20 --head "$PUBLIC_URL$PUBLIC_ENTRY_ASSET" | tr -d '\r' | awk -F': *' 'tolower($1)=="content-type" { print tolower($2); exit }')"
if [[ ! "$ENTRY_CONTENT_TYPE" =~ (javascript|text/css) ]]; then
  echo "Production served an invalid module MIME type for $PUBLIC_ENTRY_ASSET: ${ENTRY_CONTENT_TYPE:-missing}"
  false
fi
pm2 save

FRONTEND_SWAPPED=false
CODE_UPDATED=false
trap - ERR

rm -f -- "$FRONTEND_ARTIFACT" || echo "Warning: could not remove transferred frontend artifact."
if [[ "$DEPLOY_DRIVER_PATH" =~ ^/tmp/crm-deploy-[0-9]+-[0-9]+\.sh$ ]]; then
  rm -f -- "$DEPLOY_DRIVER_PATH" || echo "Warning: could not remove transferred deployment driver."
fi
if [[ -n "$BACKUP_DIST" && -d "$BACKUP_DIST" ]]; then
  rm -rf -- "$BACKUP_DIST" || echo "Warning: could not remove previous frontend backup."
fi

if [[ -n "$SERVER_STASH_SHA" ]]; then
  echo "Pre-deployment server edits remain recoverable in Git stash ${SERVER_STASH_SHA:0:12}."
fi

echo "CRM production deployment completed: ${EXPECTED_SHA:0:12}"
