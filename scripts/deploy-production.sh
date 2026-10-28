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
# mktemp creates a private directory; Nginx must be able to traverse the release root.
chmod 755 "$NEXT_DIST"

if [[ "$BACKEND_CHANGED" == true ]]; then
  if [[ "$BACKEND_DEPS_CHANGED" == true ]]; then
    npm ci --prefix backend --omit=dev
  fi
  node --check backend/src/index.js
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
