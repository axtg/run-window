# Deploying besttimetorun.com

The app runs in Docker (compose project `run-window`, port 3003) on 88.198.112.206 (Hetzner, user `ploi`), from
`/home/ploi/run.xadi.eu` (the folder kept its old name). nginx in front uses `docker/nginx-besttimetorun.com.conf`
plus certbot's TLS lines.

`deploy.sh` is the source of truth for `/home/ploi/deploy/run-xadi-eu/deploy.sh`. The server runs that copy, so after
changing it here, `scp` it there and `chmod 700` it.

## How a deploy happens

A push to `main` sends GitHub's webhook to `https://besttimetorun.com/_deploy/github`. nginx proxies it to the server's
shared `webhook` daemon (pm2 `deploy-webhook`, hooks in `/home/ploi/deploy/hooks.json`, hook id `run-xadi-eu`). The
daemon checks the signature, event, branch and repo, then runs `/home/ploi/deploy/run.sh run-xadi-eu`.

`deploy.sh`:
1. Fast-forwards the checkout.
2. Skips if that revision is already live. `--force` deploys anyway.
3. Builds the image, starts it, and waits until both `/health` and Docker's health check say healthy.
4. If anything fails, rolls back to the previous image and revision.

Output goes to `/home/ploi/deploy/run-xadi-eu/deploy.log`.
