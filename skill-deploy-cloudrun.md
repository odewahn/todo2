---
name: deploy-cloudrun
description: Use when deploying a Node.js app to the ORM playground using Cloud Run, Cloud SQL, and Cloud Build for the first time, or when updating an already-deployed app after code changes or database migrations. This is the Google-native alternative to deploy-playground — no Docker Desktop, no Kubernetes, no Istio.
---

# deploy-cloudrun

## Overview

Deploys or updates a Node.js app on ORM's playground using Cloud Run (compute), Cloud SQL (managed PostgreSQL), Cloud Build + Buildpacks (image build), and Secret Manager (user secrets). Auto-detects whether this is an initial deploy or an update. Handles both single-service apps and multi-service apps with separate frontend and backend directories.

No Docker Desktop required. No Kubernetes knowledge required. Builds happen in the cloud.

## Hardcoded Org Config

| Value | Setting |
|---|---|
| GCP Project | `strong-keyword-184513` |
| Region | `us-central1` |
| Cloud SQL Instance | `playground-postgres` |
| DNS Zone | `playground-gcp-oreilly-com` |
| DNS Domain | `playground.gcp.oreilly.com` |

## Database Model

Each user has **one PostgreSQL database** named after their GCP identity (e.g. `odewahn`). Each app they deploy gets its own **schema** within that database (e.g. `todoapp`, `blogapp`). Tables live inside the schema; the app queries them without any prefix because `search_path` is set on the IAM role.

This means:
- `DB_NAME` = the user's database (derived from `gcloud config get-value account`, local part only)
- `DB_SCHEMA` = the app name (one schema per app, isolated from other apps in the same database)
- Teardown removes the schema (`DROP SCHEMA ... CASCADE`), not the whole database

---

## Step 1: Prerequisites

Tell the user: "🔧 Checking prerequisites..."

Run ALL checks before proceeding. Fix issues as you go.

### 1.1 gcloud CLI

```bash
gcloud --version
```

If missing:
- macOS: `brew install --cask google-cloud-sdk`
- Other: tell user to visit https://cloud.google.com/sdk/docs/install

### 1.2 gcloud authentication

```bash
gcloud auth print-access-token 2>/dev/null | head -c 20
```

If that fails:
```bash
gcloud auth login
```

Walk the user through the browser auth flow. Wait for confirmation.

Also ensure application default credentials:
```bash
gcloud auth application-default print-access-token 2>/dev/null | head -c 20
```

If that fails:
```bash
gcloud auth application-default login
```

### 1.3 Set project

```bash
gcloud config set project strong-keyword-184513
```

Always run this — it is idempotent and ensures all subsequent commands target the correct project.

### 1.4 Derive user database name

```bash
GCLOUD_ACCOUNT=$(gcloud config get-value account 2>/dev/null)
USER_DB=$(echo "$GCLOUD_ACCOUNT" | cut -d'@' -f1 | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/_/g')
```

This strips the domain from the gcloud account email and normalises it to lowercase alphanumeric with underscores (e.g. `odewahn@oreilly.com` → `odewahn`). Store as `USER_DB`. This is the PostgreSQL database name used for all of this user's apps.

Tell the user:
> "Your apps will share a single database named `<USER_DB>`. Each app gets its own schema within that database."

### 1.5 Verify Cloud Build and Cloud Run APIs are enabled

```bash
gcloud services list --enabled --filter="name:(run.googleapis.com OR cloudbuild.googleapis.com OR sqladmin.googleapis.com OR secretmanager.googleapis.com)" --format="value(name)"
```

If any are missing, enable them:
```bash
gcloud services enable run.googleapis.com cloudbuild.googleapis.com sqladmin.googleapis.com secretmanager.googleapis.com
```

---

## Step 2: Detect Deploy vs Update

### 2.1 Ask for app name

Ask the user:
> "What should we call this app? This will be used as the URL subdomain and Cloud Run service name. Use lowercase letters and hyphens only (e.g. `my-api`)."

Store as `APP_NAME`. The app will be available at `https://<APP_NAME>.playground.gcp.oreilly.com`.

### 2.2 Check if already deployed

```bash
gcloud run services describe $APP_NAME --region=us-central1 --project=strong-keyword-184513 2>/dev/null
```

- If the service **does not exist** → this is an **initial deploy** (continue to Step 3)
- If the service **exists** → this is an **update** (skip to Step 9: Update Flow)

For multi-service apps (detected in Step 3), check the backend service name: `${APP_NAME}-backend`.

---

## Step 3: Detect App Structure

### 3.1 Single-service vs multi-service

Check for a multi-service layout (separate frontend and backend):

```bash
test -f backend/package.json && test -f frontend/package.json && echo "multi" || echo "single"
```

- **multi**: app has `backend/` and `frontend/` subdirectories, each with `package.json`
- **single**: app has a single root `package.json`

Store as `APP_STRUCTURE` (`multi` or `single`).

For multi-service apps:
- The backend Cloud Run service will be named `${APP_NAME}-backend`
- The frontend Cloud Run service will be named `${APP_NAME}-frontend`
- Deploy backend first (Step 7.1), then frontend (Step 7.2)

For single-service apps, the single Cloud Run service is named `$APP_NAME`.

### 3.2 Detect app port

**Single-service:** search in root:
```bash
grep -rE "process\.env\.PORT|\.listen\([0-9]+" . --include="*.js" --include="*.ts" | grep -v node_modules | head -5
```

**Multi-service:** search in `backend/`:
```bash
grep -rE "process\.env\.PORT|\.listen\([0-9]+" backend/ --include="*.js" --include="*.ts" | head -5
```

Default to 8080 if nothing found. Confirm with user. Store as `APP_PORT`.

The frontend port is always 80 (nginx serves the built static app).

### 3.3 Detect database

**Single-service:**
```bash
cat package.json | grep -E '"pg"|"pg-promise"|"postgres"|"mysql2"|"mysql"|"mongoose"|"mongodb"|"redis"|"ioredis"'
```

**Multi-service:**
```bash
cat backend/package.json | grep -E '"pg"|"pg-promise"|"postgres"|"mysql2"|"mysql"|"mongoose"|"mongodb"|"redis"|"ioredis"'
```

| Package | Database |
|---|---|
| `pg`, `pg-promise`, `postgres` | PostgreSQL |
| `mysql2`, `mysql` | MySQL |
| `mongoose`, `mongodb` | MongoDB |
| `redis`, `ioredis` | Redis (no SQL provisioning needed) |

If a match is found, ask:
> "I detected you're using <DATABASE>. Should I provision a <DATABASE> instance alongside your app? (yes/no)"

Store as `DB_TYPE` (`postgres`, `mysql`, `mongodb`, `redis`, or empty).

**Note:** Cloud SQL supports PostgreSQL and MySQL. MongoDB and Redis are not available as managed Cloud SQL options — tell the user they will need to provide their own connection string for those, stored as a Secret Manager secret.

---

## Step 4: Provision Cloud SQL (skip if DB_TYPE is empty, redis, or mongodb)

Tell the user: "🗄️ Setting up Cloud SQL..."

### 4.1 Check if shared instance exists

```bash
gcloud sql instances describe playground-postgres --project=strong-keyword-184513 2>/dev/null | grep "^name:"
```

If it does not exist, create it:
```bash
gcloud sql instances create playground-postgres \
  --database-version=POSTGRES_15 \
  --tier=db-n1-standard-2 \
  --region=us-central1 \
  --project=strong-keyword-184513
```

This takes 3–5 minutes. Tell the user to wait.

For MySQL (`DB_TYPE=mysql`), use `--database-version=MYSQL_8_0` instead.

### 4.2 Create the user database (one-time)

Check if the user's database already exists:

```bash
gcloud sql databases describe $USER_DB \
  --instance=playground-postgres \
  --project=strong-keyword-184513 2>/dev/null | grep "^name:"
```

If it does **not** exist, create it:

```bash
gcloud sql databases create $USER_DB \
  --instance=playground-postgres \
  --project=strong-keyword-184513
```

If it already exists, skip creation — this database is shared across all the user's apps.

### 4.3 Create the app service account

Service account names are limited to 30 characters. Truncate `APP_NAME` to 23 characters if needed and append `-sa`:

```bash
SA_NAME="${APP_NAME:0:23}-sa"
gcloud iam service-accounts create $SA_NAME \
  --display-name="$APP_NAME Cloud Run SA" \
  --project=strong-keyword-184513
```

Store the full email as `SA_EMAIL="${SA_NAME}@strong-keyword-184513.iam.gserviceaccount.com"`.

### 4.4 Grant IAM database access

```bash
gcloud projects add-iam-policy-binding strong-keyword-184513 \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/cloudsql.instanceUser"

gcloud projects add-iam-policy-binding strong-keyword-184513 \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/cloudsql.client"
```

### 4.5 Create the schema and IAM-linked PostgreSQL role

Connect to Cloud SQL as the admin user and run the following against the user's database. This creates a schema for this app, an IAM-linked role, and sets `search_path` so the app can query tables without schema-prefixing.

```bash
gcloud sql connect playground-postgres --user=postgres --database=$USER_DB --project=strong-keyword-184513 <<EOF
-- Create schema for this app (idempotent)
CREATE SCHEMA IF NOT EXISTS "$APP_NAME";

-- Create IAM-linked role (idempotent)
DO \$\$ BEGIN
  CREATE USER "${SA_NAME}@strong-keyword-184513.iam" WITH LOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END \$\$;

-- Grant access scoped to this app's schema only
GRANT CONNECT ON DATABASE "$USER_DB" TO "${SA_NAME}@strong-keyword-184513.iam";
GRANT USAGE, CREATE ON SCHEMA "$APP_NAME" TO "${SA_NAME}@strong-keyword-184513.iam";
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA "$APP_NAME" TO "${SA_NAME}@strong-keyword-184513.iam";
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA "$APP_NAME" TO "${SA_NAME}@strong-keyword-184513.iam";
ALTER DEFAULT PRIVILEGES IN SCHEMA "$APP_NAME"
  GRANT ALL ON TABLES TO "${SA_NAME}@strong-keyword-184513.iam";
ALTER DEFAULT PRIVILEGES IN SCHEMA "$APP_NAME"
  GRANT ALL ON SEQUENCES TO "${SA_NAME}@strong-keyword-184513.iam";

-- Set search_path so the app queries the right schema without prefixing
ALTER ROLE "${SA_NAME}@strong-keyword-184513.iam" SET search_path = "$APP_NAME";
EOF
```

The `ALTER ROLE ... SET search_path` means the app queries `SELECT * FROM todos` and PostgreSQL automatically looks in the `$APP_NAME` schema. No table-name prefixes needed in application code.

If `gcloud sql connect` is not available (no `psql` locally), tell the user:
> "I need to create the app schema and role. Please run the SQL in Cloud SQL Studio at https://console.cloud.google.com/sql/instances/playground-postgres/studio — I'll provide the exact commands."

Then output the SQL commands for the user to run manually, with `$USER_DB`, `$APP_NAME`, and `$SA_NAME` substituted.

Store connection env vars:
```
DB_HOST=/cloudsql/strong-keyword-184513:us-central1:playground-postgres
DB_NAME=$USER_DB
DB_SCHEMA=$APP_NAME
DB_USER=${SA_NAME}@strong-keyword-184513.iam
```

**No password is created. No secret is stored.**

---

## Step 5: Patch DB Connection Code

This step only applies if `DB_TYPE` is `postgres` or `mysql`.

### 5.1 Find the database connection file

Search for the file where the database pool/client is created:

```bash
grep -rl "connectionString\|DATABASE_URL\|new Pool\|createPool\|createConnection" . \
  --include="*.js" --include="*.ts" | grep -v node_modules | head -5
```

Store the first match as `DB_FILE`.

### 5.2 Check if already patched

If `DB_FILE` already contains `process.env.DB_HOST` and a check for `/cloudsql`, it is already patched — skip this step.

### 5.3 Patch for dual-mode connection

Tell the user:
> "I need to update your database connection code to support both local development (TCP) and Cloud Run (Cloud SQL socket). I'll make this change to `<DB_FILE>`."

Show the user the proposed change. If they approve, apply it.

**For PostgreSQL (`pg` / `pg-promise`):**

Find the existing Pool/Client instantiation and replace the connection setup with:

```javascript
const isCloudSQL = process.env.DB_HOST?.startsWith('/cloudsql');

const pool = new Pool(
  isCloudSQL
    ? {
        host: process.env.DB_HOST,
        database: process.env.DB_NAME,    // user database, e.g. "odewahn"
        user: process.env.DB_USER,
        // search_path is set on the IAM role in Cloud SQL, but we set it
        // explicitly here too as a safety net
        options: `--search_path=${process.env.DB_SCHEMA}`,
        // no password — Cloud SQL Auth Proxy handles auth via service account
      }
    : {
        connectionString: process.env.DATABASE_URL
          || 'postgres://localhost/dev',
      }
);
```

Keep the existing local `connectionString` fallback if one was present. The `options` field is ignored in local mode since it only applies to the Cloud SQL branch.

**For MySQL (`mysql2`):**

MySQL does not have schemas in the PostgreSQL sense. For MySQL, `DB_NAME` is the app-specific database name (one database per app, as before). The schema pattern only applies to PostgreSQL.

```javascript
const isCloudSQL = process.env.DB_HOST?.startsWith('/cloudsql');

const pool = mysql.createPool(
  isCloudSQL
    ? {
        socketPath: process.env.DB_HOST,
        database: process.env.DB_NAME,
        user: process.env.DB_USER,
      }
    : {
        uri: process.env.DATABASE_URL || 'mysql://root@localhost/dev',
      }
);
```

### 5.4 Commit the patch

```bash
git add $DB_FILE
git commit -m "chore: add Cloud SQL dual-mode connection (local TCP + Cloud Run socket)"
```

---

## Step 6: Patch Frontend for Cloud Run URL (multi-service only)

Skip this step for single-service apps.

### 6.1 Check if already patched

Search for `VITE_API_URL` usage in the frontend source:

```bash
grep -rl "VITE_API_URL" frontend/src/ 2>/dev/null | head -3
```

If found, the frontend is already patched — skip to Step 6.3.

### 6.2 Patch API calls

Find files making API calls with relative `/api/` paths:

```bash
grep -rl "fetch.*['\"]\/api\/" frontend/src/ --include="*.js" --include="*.jsx" --include="*.ts" --include="*.tsx" | head -10
```

For each file found, tell the user the proposed change and ask for confirmation before applying:

> "I'll add `const API_BASE = import.meta.env.VITE_API_URL ?? ''` near the top of each file and prefix all `/api/` fetch calls with `${API_BASE}`. This makes the app work both locally (Vite proxy) and on Cloud Run (direct URL)."

Apply the change: add the `API_BASE` constant and update fetch calls. The empty string fallback means Vite's proxy config continues to work in local development without any change.

### 6.3 Patch frontend Dockerfile for build arg

The Vite build runs inside Docker during Cloud Build. `VITE_API_URL` must be declared as a Docker build arg to be available during `npm run build`.

Check the frontend Dockerfile:

```bash
grep "ARG VITE_API_URL" frontend/Dockerfile 2>/dev/null
```

If not present, add the ARG to the builder stage. Find the line `RUN npm run build` and insert before it:

```dockerfile
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
```

### 6.4 Commit frontend changes

```bash
git add frontend/
git commit -m "chore: add VITE_API_URL support for Cloud Run backend URL"
```

---

## Step 7: Deploy Services

### 7.1 Deploy backend (or single service)

Tell the user: "🚀 Deploying backend to Cloud Run — Cloud Build will build the image in the cloud (no local Docker needed)..."

**Single-service:**
```bash
gcloud run deploy $APP_NAME \
  --source . \
  --region=us-central1 \
  --project=strong-keyword-184513 \
  --service-account=$SA_EMAIL \
  --add-cloudsql-instances=strong-keyword-184513:us-central1:playground-postgres \
  --set-env-vars="PORT=$APP_PORT,DB_HOST=/cloudsql/strong-keyword-184513:us-central1:playground-postgres,DB_NAME=$USER_DB,DB_SCHEMA=$APP_NAME,DB_USER=${SA_NAME}@strong-keyword-184513.iam" \
  --allow-unauthenticated \
  --max-instances=3 \
  --concurrency=80 \
  --cpu=1 \
  --memory=512Mi
```

**Multi-service (backend):**
```bash
gcloud run deploy ${APP_NAME}-backend \
  --source ./backend \
  --region=us-central1 \
  --project=strong-keyword-184513 \
  --service-account=$SA_EMAIL \
  --add-cloudsql-instances=strong-keyword-184513:us-central1:playground-postgres \
  --set-env-vars="PORT=$APP_PORT,DB_HOST=/cloudsql/strong-keyword-184513:us-central1:playground-postgres,DB_NAME=$USER_DB,DB_SCHEMA=$APP_NAME,DB_USER=${SA_NAME}@strong-keyword-184513.iam" \
  --allow-unauthenticated \
  --max-instances=3 \
  --concurrency=80 \
  --cpu=1 \
  --memory=512Mi
```

Wait for the deploy to complete. On success, capture the service URL:

```bash
BACKEND_URL=$(gcloud run services describe ${APP_NAME}-backend \
  --region=us-central1 \
  --project=strong-keyword-184513 \
  --format="value(status.url)")
```

If `gcloud run deploy` fails, read the Cloud Build logs:
```bash
gcloud builds list --limit=1 --project=strong-keyword-184513 --format="value(id)" | \
  xargs -I{} gcloud builds log {} --project=strong-keyword-184513
```
Diagnose and fix before continuing.

### 7.2 Deploy frontend (multi-service only)

Tell the user: "🚀 Deploying frontend to Cloud Run..."

```bash
gcloud run deploy ${APP_NAME}-frontend \
  --source ./frontend \
  --region=us-central1 \
  --project=strong-keyword-184513 \
  --allow-unauthenticated \
  --set-build-env-vars="VITE_API_URL=$BACKEND_URL" \
  --max-instances=3 \
  --concurrency=80 \
  --cpu=1 \
  --memory=256Mi
```

Wait for the deploy to complete. Capture the frontend URL:

```bash
FRONTEND_URL=$(gcloud run services describe ${APP_NAME}-frontend \
  --region=us-central1 \
  --project=strong-keyword-184513 \
  --format="value(status.url)")
```

**For single-service apps**, `FRONTEND_URL` equals the single service URL captured in Step 7.1.

---

## Step 8: Run Migrations (if detected)

Check for migration scripts or tools:

```bash
# Check for migration scripts
ls migrations/ db/migrations/ database/migrations/ 2>/dev/null
grep -E '"migrate":|"migration":' package.json backend/package.json 2>/dev/null
grep -E '"knex"|"sequelize-cli"|"prisma"|"flyway"' package.json backend/package.json 2>/dev/null
# Check for a raw schema.sql
ls schema.sql backend/schema.sql 2>/dev/null
```

If migrations or a schema.sql are found, ask:
> "I detected database setup scripts. Should I run them now against Cloud SQL? (yes/no)"

#### If yes — migration tool (knex, prisma, sequelize):

Determine the command:

| Tool | Command args |
|---|---|
| `knex` | `["npx", "knex", "migrate:latest"]` |
| `sequelize-cli` | `["npx", "sequelize-cli", "db:migrate"]` |
| `prisma` | `["npx", "prisma", "migrate", "deploy"]` |
| `migrate` script in package.json | `["npm", "run", "migrate"]` |

Get the backend image that was just deployed:
```bash
BACKEND_IMAGE=$(gcloud run services describe ${APP_NAME}-backend \
  --region=us-central1 \
  --project=strong-keyword-184513 \
  --format="value(spec.template.spec.containers[0].image)")
```

Create and execute a Cloud Run Job:
```bash
gcloud run jobs create ${APP_NAME}-migrate \
  --image=$BACKEND_IMAGE \
  --command=COMMAND \
  --args=ARG1,ARG2,... \
  --service-account=$SA_EMAIL \
  --add-cloudsql-instances=strong-keyword-184513:us-central1:playground-postgres \
  --set-env-vars="DB_HOST=/cloudsql/strong-keyword-184513:us-central1:playground-postgres,DB_NAME=$USER_DB,DB_SCHEMA=$APP_NAME,DB_USER=${SA_NAME}@strong-keyword-184513.iam" \
  --region=us-central1 \
  --project=strong-keyword-184513

gcloud run jobs execute ${APP_NAME}-migrate \
  --region=us-central1 \
  --project=strong-keyword-184513 \
  --wait
```

Stream the job logs:
```bash
gcloud run jobs executions list --job=${APP_NAME}-migrate \
  --region=us-central1 --project=strong-keyword-184513 \
  --limit=1 --format="value(name)" | \
  xargs -I{} gcloud logging read "resource.labels.job_name=${APP_NAME}-migrate" \
  --project=strong-keyword-184513 --limit=50 --format="value(textPayload)"
```

#### If yes — schema.sql (no migration tool):

Apply `schema.sql` via `gcloud sql connect`. The schema must be set so tables land in the app's schema, not `public`:

```bash
gcloud sql connect playground-postgres \
  --user=postgres \
  --database=$USER_DB \
  --project=strong-keyword-184513 <<EOF
SET search_path = "$APP_NAME";
$(cat schema.sql)
EOF
```

If `psql` is not available locally, tell the user to run the schema manually in Cloud SQL Studio, prefaced with `SET search_path = '<APP_NAME>';`.

---

## Step 9: Map Custom Domain

Tell the user: "🌐 Setting up custom domain..."

### 9.1 Create Cloud Run domain mapping

For single-service apps, map to `APP_NAME.playground.gcp.oreilly.com`:
```bash
gcloud run domain-mappings create \
  --service=$APP_NAME \
  --domain=${APP_NAME}.playground.gcp.oreilly.com \
  --region=us-central1 \
  --project=strong-keyword-184513
```

For multi-service apps, map the **frontend** service only (the frontend is the user-facing entry point):
```bash
gcloud run domain-mappings create \
  --service=${APP_NAME}-frontend \
  --domain=${APP_NAME}.playground.gcp.oreilly.com \
  --region=us-central1 \
  --project=strong-keyword-184513
```

### 9.2 Get the DNS record to create

```bash
gcloud run domain-mappings describe \
  --domain=${APP_NAME}.playground.gcp.oreilly.com \
  --region=us-central1 \
  --project=strong-keyword-184513 \
  --format="yaml(status.resourceRecords)"
```

This returns a record type (CNAME or A/AAAA) and value. Extract the type and value.

### 9.3 Create DNS record in Cloud DNS

For a CNAME record:
```bash
gcloud dns record-sets create ${APP_NAME}.playground.gcp.oreilly.com. \
  --type=CNAME \
  --ttl=300 \
  --rrdatas=<VALUE_FROM_MAPPING>. \
  --zone=playground-gcp-oreilly-com \
  --project=strong-keyword-184513
```

For A records (there may be multiple):
```bash
gcloud dns record-sets create ${APP_NAME}.playground.gcp.oreilly.com. \
  --type=A \
  --ttl=300 \
  --rrdatas=<IP1>,<IP2>,... \
  --zone=playground-gcp-oreilly-com \
  --project=strong-keyword-184513
```

---

## Step 10: Verify and Report

Tell the user: "✅ Deployment complete!"

Report the URLs:
- For single-service: `https://<APP_NAME>.playground.gcp.oreilly.com` (custom) and the `*.run.app` URL
- For multi-service: `https://<APP_NAME>.playground.gcp.oreilly.com` → frontend, and the backend `*.run.app` URL

Tell the user:
> "Your app is deployed. The custom domain may take a few minutes to become active — TLS certificates are provisioned automatically.
>
> - App URL: https://<APP_NAME>.playground.gcp.oreilly.com
> - Cloud Run URL (available immediately): <FRONTEND_URL>
>
> Would you like me to monitor until the custom domain is reachable? I'll check every 30 seconds."

If yes, poll every 30 seconds for up to 15 minutes:
```bash
curl -s -o /dev/null -w "%{http_code}" https://${APP_NAME}.playground.gcp.oreilly.com
```

When HTTP 200 is returned, confirm the app is live.

If not reachable after 15 minutes, debug:
```bash
gcloud run domain-mappings describe \
  --domain=${APP_NAME}.playground.gcp.oreilly.com \
  --region=us-central1 --project=strong-keyword-184513
gcloud run services describe ${APP_NAME} --region=us-central1 --project=strong-keyword-184513
```

---

## Step 9: Update Flow

Only run this section if the service already exists (detected in Step 2.2).

Tell the user: "🔄 Existing deployment detected — starting update flow..."

### 9.1 Detect what changed

```bash
git diff HEAD~1 --name-only 2>/dev/null
```

If git history is unavailable, ask:
> "Has your app code changed since the last deploy?"

**Code changed (or unknown):** proceed to rebuild.
**Only docs or config changed:** ask if a redeploy is needed.

### 9.2 Rebuild and redeploy

**Single-service:**
```bash
gcloud run deploy $APP_NAME \
  --source . \
  --region=us-central1 \
  --project=strong-keyword-184513
```

**Multi-service backend:**
```bash
gcloud run deploy ${APP_NAME}-backend \
  --source ./backend \
  --region=us-central1 \
  --project=strong-keyword-184513
```

**Multi-service frontend** (only if frontend code changed):

Get current backend URL first:
```bash
BACKEND_URL=$(gcloud run services describe ${APP_NAME}-backend \
  --region=us-central1 --project=strong-keyword-184513 \
  --format="value(status.url)")

gcloud run deploy ${APP_NAME}-frontend \
  --source ./frontend \
  --region=us-central1 \
  --project=strong-keyword-184513 \
  --set-build-env-vars="VITE_API_URL=$BACKEND_URL"
```

### 9.3 Run migrations (if detected)

Same detection logic as Step 8. If migrations exist, ask:
> "I detected database migrations. Should I run them against Cloud SQL now? (yes/no)"

If yes:
```bash
gcloud run jobs execute ${APP_NAME}-migrate \
  --region=us-central1 \
  --project=strong-keyword-184513 \
  --wait
```

If the job doesn't exist yet (new migration added since initial deploy):
Create it as in Step 8, then execute.

### 9.4 Confirm rollout

```bash
gcloud run services describe $APP_NAME \
  --region=us-central1 \
  --project=strong-keyword-184513 \
  --format="value(status.latestReadyRevisionName,status.url)"
```

Tell the user the new revision name and URL. Offer to roll back if needed:
> "If anything looks wrong, I can roll back to the previous revision instantly. Just say 'rollback'."

To roll back:
```bash
PREV=$(gcloud run revisions list \
  --service=$APP_NAME \
  --region=us-central1 \
  --project=strong-keyword-184513 \
  --sort-by="~createTime" \
  --limit=2 \
  --format="value(name)" | tail -1)

gcloud run services update-traffic $APP_NAME \
  --region=us-central1 \
  --project=strong-keyword-184513 \
  --to-revisions=${PREV}=100
```
