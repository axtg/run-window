#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"
export GIT_TERMINAL_PROMPT=0 GCM_INTERACTIVE=never
APP=/home/ploi/run.xadi.eu
STATE=/home/ploi/deploy/run-xadi-eu
exec 9>"$STATE/deploy.lock"
flock -w 600 9 || { printf '%s\n' 'ERROR: deployment lock timed out'; exit 1; }
cd "$APP"
compose() { docker compose -p run-window -f "$APP/docker-compose.yml" -f "$STATE/compose.override.yml" "$@"; }
health() {
  for attempt in {1..45}; do
    if curl --fail --silent --max-time 3 http://127.0.0.1:3003/health | node -e '
      let b="";process.stdin.on("data",d=>b+=d);process.stdin.on("end",()=>{
        try{process.exit(JSON.parse(b).status==="healthy"?0:1)}catch{process.exit(1)}
      });'; then
      local cid
      cid=$(compose ps -q run-window)
      [[ -n "$cid" && "$(docker inspect --format '{{.State.Health.Status}}' "$cid")" == healthy ]] && return 0
    fi
    sleep 2
  done
  return 1
}
printf '[%s] Deployment starting\n' "$(date -u +%FT%TZ)"
[[ "$(git branch --show-current)" == main ]] || { printf '%s\n' 'ERROR: expected main branch'; exit 1; }
[[ -z "$(git status --porcelain)" ]] || { printf '%s\n' 'ERROR: checkout is not clean'; exit 1; }
timeout 120 git fetch --quiet origin '+refs/heads/main:refs/remotes/origin/main' >/dev/null 2>&1 || { printf '%s\n' 'ERROR: Git fetch failed'; exit 1; }
previous=$(git rev-parse HEAD)
target=$(git rev-parse origin/main)
# Webhook redeliveries and duplicate pushes: nothing new means no rebuild. --force deploys anyway.
if [[ "$target" == "$(cat "$STATE/deployed-revision" 2>/dev/null)" && "${1:-}" != --force ]]; then
  printf 'Already live at %s; nothing to do\n' "$target"; exit 0
fi
git merge-base --is-ancestor "$previous" "$target" || { printf '%s\n' 'ERROR: main diverged'; exit 1; }
old_image=$(compose images -q run-window)
rollback_tag="run-window-rollback:$(date -u +%Y%m%d%H%M%S)"
if [[ -n "$old_image" ]]; then docker image tag "$old_image" "$rollback_tag"; fi
recover() {
  result=$?
  trap - ERR
  printf '%s\n' 'ERROR: deployment failed; attempting rollback'
  if [[ -n "$old_image" ]] && git reset --keep "$previous" && docker image tag "$rollback_tag" run-window-run-window && compose up -d --no-build --force-recreate && health; then
    printf '%s\n' 'Rollback healthy; deployment remains failed'
  else
    printf '%s\n' 'CRITICAL: rollback unavailable or failed; manual intervention required'
  fi
  exit "$result"
}
trap recover ERR
git merge --ff-only --quiet "$target"
timeout 600 docker compose -p run-window -f "$APP/docker-compose.yml" -f "$STATE/compose.override.yml" build --pull
compose up -d --no-build
health
printf '%s\n' "$target" > "$STATE/deployed-revision.tmp"
mv "$STATE/deployed-revision.tmp" "$STATE/deployed-revision"
trap - ERR
printf '[%s] Deployment healthy at %s\n' "$(date -u +%FT%TZ)" "$target"
