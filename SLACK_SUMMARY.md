# Slack Summary — Vibe-to-Cloud Skill Test

Hey all — here's a quick summary of where things landed after testing the scaffold + deploy-cloudrun skills end to end.

**What worked:** Local dev with Dev Container was smooth. The scaffold skill generated a working full-stack app (Express + React + Postgres) and the deploy skill got both services built and running on Cloud Run with the database schema and migrations applied.

**What needs fixing in the skills:**
- nginx is hardcoded to port 80 but Cloud Run injects PORT=8080 — the frontend container crashed on startup
- `PORT` can't be passed as an env var to Cloud Run (it's reserved)
- `--set-build-env-vars` requires `gcloud beta` not GA
- `gcloud sql connect` breaks on IPv6 hosts and needs the Cloud SQL Proxy installed separately
- The Cloud SQL tier in the script is blocked by our org policy — needs to use `db-f1-micro`

**The bigger blocker — IAM permissions:** The skill assumes the deploying user can grant project-level IAM roles. Regular users can't. This means the Cloud Run service account can't connect to Cloud SQL, and services can't be made public. Both need a project admin to fix. We should decide whether to pre-provision shared IAM infrastructure or use a shared service account so individual users don't need those permissions.

**Custom domain mapping** also requires domain verification that has to be set up by an admin — the `*.playground.gcp.oreilly.com` pattern won't work out of the box for new users.

**Architecture question:** The current design deploys frontend and backend as two separate Cloud Run services with nginx serving the static frontend. This wasn't a deliberate choice and caused most of the complexity. Worth considering a single-service model where Express serves the Vite build — simpler deploy, one URL, no CORS, no nginx. Probably the right default for prototype/playground use.

Full notes with details and exact commands in `VIBE_DEPLOY_NOTES.md`.
