# Cloud Run Deployment Report — odewahn-todo2

**Date:** 2026-03-14
**App:** odewahn-todo2 (multi-service: React frontend + Node.js/Express backend)
**Target:** Cloud Run on GCP project `strong-keyword-184513`

---

## What Was Deployed

| Component | URL |
|---|---|
| Backend (Node.js/Express) | https://odewahn-todo2-backend-j7qgmz4hba-uc.a.run.app |
| Frontend (React/Vite via nginx) | https://odewahn-todo2-frontend-897232339923.us-central1.run.app |
| Database | Cloud SQL `playground-postgres` → `odewahn` DB → `odewahn-todo2` schema |

---

## Errors Encountered and Fixes Applied

### 1. Cloud SQL instance tier not allowed
**Error:**
```
ERROR: Invalid request: Only custom or shared-core instance Billing Tier type allowed for PostgreSQL database.
```
**Cause:** The skill specifies `--tier=db-n1-standard-2` (a dedicated-core tier), which is blocked by an org policy in this GCP project.
**Fix:** Changed tier to `db-f1-micro` (shared-core), which is permitted.

---

### 2. Cloud SQL `postgres` user had no password set
**Error:**
```
psql: FATAL: password authentication failed for user "postgres"
```
**Cause:** The newly created `playground-postgres` instance had no password set for the `postgres` admin user. `gcloud beta sql connect` prompts interactively and doesn't accept `PGPASSWORD`.
**Fix:** Set the password explicitly:
```bash
gcloud sql users set-password postgres \
  --instance=playground-postgres \
  --password=TempAdminPass123! \
  --project=strong-keyword-184513
```
Then connected directly via the Cloud SQL Proxy v1 binary (`cloud_sql_proxy`) + `psql` with `PGPASSWORD` set, bypassing the interactive prompt.

---

### 3. IPv6 address blocked by `gcloud sql connect`
**Error:**
```
ERROR: HTTPError 400: Invalid flag for instance role: CloudSQL Second Generation doesn't support IPv6 networks/subnets
```
**Cause:** The local machine's active network interface has an IPv6 address; `gcloud sql connect` tried to use it, which Cloud SQL rejected.
**Fix:** Used `gcloud beta sql connect` (which routes via the Cloud SQL Proxy v1), then when that also failed due to a missing binary, installed it with:
```bash
gcloud components install cloud_sql_proxy
```
Then switched to running the proxy directly and connecting with `psql`.

---

### 4. `PORT` is a reserved Cloud Run environment variable
**Error:**
```
ERROR: spec.template.spec.containers[0].env: The following reserved env names were provided: PORT.
```
**Cause:** The `gcloud run deploy` command included `PORT=3001` in `--set-env-vars`. Cloud Run sets `PORT` automatically and does not allow it to be overridden.
**Fix:** Removed `PORT` from `--set-env-vars`. The backend already reads `process.env.PORT || 3001`, so Cloud Run's injected `PORT=8080` is used automatically.

---

### 5. Frontend nginx container failed to start (port mismatch)
**Error:**
```
ERROR: The user-provided container failed to start and listen on the port defined provided by the PORT=8080 environment variable within the allocated timeout.
```
**Cause:** The frontend `Dockerfile` ran nginx listening on hardcoded port 80, but Cloud Run injects `PORT=8080` and health-checks that port. The container appeared unresponsive.
**Fix:** Updated `frontend/nginx.conf` to use `${PORT}` instead of `80`, and updated `frontend/Dockerfile` to use `envsubst` to substitute the env variable at container startup:

`nginx.conf` change:
```nginx
# Before
listen 80;
# After
listen ${PORT};
```

`Dockerfile` change:
```dockerfile
# Before
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]

# After
COPY nginx.conf /etc/nginx/conf.d/default.conf.template
EXPOSE 8080
ENV PORT=8080
CMD ["/bin/sh", "-c", "envsubst '$PORT' < /etc/nginx/conf.d/default.conf.template > /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'"]
```

---

### 6. `--set-build-env-vars` not available in GA gcloud
**Error:**
```
ERROR: unrecognized arguments: --set-build-env-vars
```
**Cause:** The `--set-build-env-vars` flag (needed to pass `VITE_API_URL` into the Docker build for Vite) is only available in `gcloud beta run deploy`, not the GA release track.
**Fix:** Switched to `gcloud beta run deploy` for the frontend deployment.

---

## Items Requiring Project Admin Action

The deploying account (`odewahn@oreilly.com`) only has `roles/discoveryengine.notebookLmUser` at the project level. Two operations were blocked:

### A. Cloud SQL IAM roles for the service account
The backend service account (`odewahn-todo2-sa@strong-keyword-184513.iam.gserviceaccount.com`) needs these roles to connect to Cloud SQL at runtime:
```bash
gcloud projects add-iam-policy-binding strong-keyword-184513 \
  --member="serviceAccount:odewahn-todo2-sa@strong-keyword-184513.iam.gserviceaccount.com" \
  --role="roles/cloudsql.instanceUser"

gcloud projects add-iam-policy-binding strong-keyword-184513 \
  --member="serviceAccount:odewahn-todo2-sa@strong-keyword-184513.iam.gserviceaccount.com" \
  --role="roles/cloudsql.client"
```
**Impact:** Without these, the backend will fail to connect to the database at runtime. The services are deployed and running, but API calls that hit the DB will return errors.

### B. Public (unauthenticated) access to Cloud Run services
The `--allow-unauthenticated` flag was silently ignored. Both services require authentication to invoke:
```bash
gcloud beta run services add-iam-policy-binding \
  --region=us-central1 --member=allUsers --role=roles/run.invoker odewahn-todo2-backend

gcloud beta run services add-iam-policy-binding \
  --region=us-central1 --member=allUsers --role=roles/run.invoker odewahn-todo2-frontend
```
**Impact:** Requests to both `*.run.app` URLs will receive `403 Forbidden` until this is resolved.

### C. Custom domain mapping
Mapping `odewahn-todo2.playground.gcp.oreilly.com` requires the domain to be verified in Google Search Console under the deploying account. This is a one-time setup typically done by a project or DNS admin.

---

## What Was Already Correct in the App

The app was well-prepared for Cloud Run before deployment started:
- `backend/src/db.js` already had dual-mode connection (Cloud SQL socket vs. local TCP)
- `frontend/src/App.jsx` already used `VITE_API_URL ?? ""` for API base URL
- `frontend/Dockerfile` already had `ARG VITE_API_URL` / `ENV VITE_API_URL`
- `backend/package.json` had `migrate:up` script using `node-pg-migrate` with `--schema $DB_SCHEMA`
- Migration (`1_create_items.sql`) ran successfully via local Cloud SQL proxy connection
