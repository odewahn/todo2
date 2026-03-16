---
name: scaffold-playground-app
description: Use when a user wants to create a new Node.js app for the ORM playground from scratch. Generates a complete Express + PostgreSQL + React/Vite starter project pre-wired for local development (Dev Container, Docker Compose) and cloud deployment (deploy-cloudrun skill). Run this before writing any application code.
---

# scaffold-playground-app

## Overview

Generates a new full-stack starter project with:
- **Backend**: Node.js/Express with a schema-aware PostgreSQL connection
- **Frontend**: React/Vite with the API base URL pattern pre-configured
- **Local dev**: Dev Container + Docker Compose with a local PostgreSQL that mirrors the Cloud SQL schema structure
- **Cloud ready**: Dockerfiles and db.js already compatible with `/deploy-cloudrun` — no changes needed before first deploy

The generated project is minimal but functional: the backend has one working API route, the frontend calls it, everything runs on `npm run dev`. The user can start building immediately.

## Hardcoded Org Config

| Value | Setting |
|---|---|
| GCP Project | `strong-keyword-184513` |
| Local DB host (Dev Container) | `db` (Docker Compose service name) |
| Local DB user | `appuser` |
| Local DB password | `devpassword` |
| Local DB port | `5432` |

---

## Step 1: Collect App Info

### 1.1 Ask for app name

Ask the user:
> "What's the name of your new app? Use lowercase letters and hyphens only (e.g. `my-app`). This becomes the project directory name, Cloud Run service name, and database schema name."

Store as `APP_NAME`. Derive a filesystem-safe version with underscores for use as the PostgreSQL schema name (hyphens are valid in quoted identifiers but awkward):

```bash
APP_SCHEMA=$(echo "$APP_NAME" | tr '-' '_')
```

Store as `APP_SCHEMA`.

### 1.2 Derive user database name

Try to read from gcloud:

```bash
GCLOUD_ACCOUNT=$(gcloud config get-value account 2>/dev/null)
```

If `GCLOUD_ACCOUNT` is non-empty:
```bash
USER_DB=$(echo "$GCLOUD_ACCOUNT" | cut -d'@' -f1 | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/_/g')
```

If gcloud is not authenticated or the account is not set, ask the user:
> "What's your ORM username (the part before @oreilly.com)? This will be your shared database name across all your apps."

Store as `USER_DB`.

### 1.3 Confirm and create directory

Tell the user:
> "I'll create a new project at `./<APP_NAME>/` with:
> - Local database: `<USER_DB>` (Postgres), schema: `<APP_SCHEMA>`
> - Backend: Express on port 3001
> - Frontend: React/Vite on port 5173
>
> Ready to scaffold?"

Wait for confirmation. Then:

```bash
mkdir -p $APP_NAME
cd $APP_NAME
```

All subsequent file writes are relative to `$APP_NAME/`.

---

## Step 2: Write Backend Files

### 2.1 `backend/package.json`

```json
{
  "name": "<APP_NAME>-backend",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "node --watch src/index.js",
    "start": "node src/index.js",
    "migrate:up": "node-pg-migrate up --schema $DB_SCHEMA --migrations-dir migrations",
    "migrate:down": "node-pg-migrate down --schema $DB_SCHEMA --migrations-dir migrations",
    "migrate:create": "node-pg-migrate create --schema $DB_SCHEMA --migrations-dir migrations --migration-file-language sql"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "express": "^4.18.2",
    "pg": "^8.11.3"
  },
  "devDependencies": {
    "node-pg-migrate": "^7.0.0"
  }
}
```

### 2.2 `backend/src/db.js`

This is the central file that makes the project cloud-ready from day one. Write it exactly as shown — both branches use `DB_SCHEMA` so local and cloud environments behave identically.

```javascript
import pg from 'pg';

const { Pool } = pg;

const isCloudSQL = process.env.DB_HOST?.startsWith('/cloudsql');
const options = process.env.DB_SCHEMA
  ? `--search_path=${process.env.DB_SCHEMA}`
  : undefined;

const pool = new Pool(
  isCloudSQL
    ? {
        host: process.env.DB_HOST,
        database: process.env.DB_NAME,
        user: process.env.DB_USER,
        options,
      }
    : {
        connectionString: process.env.DATABASE_URL,
        ...(options && { options }),
      }
);

pool.on('error', (err) => {
  console.error('Unexpected database error', err);
});

export default pool;
```

### 2.3 `backend/src/index.js`

```javascript
import express from 'express';
import cors from 'cors';
import itemsRouter from './routes/items.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
app.use('/api/items', itemsRouter);

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});
```

### 2.4 `backend/src/routes/items.js`

A working CRUD route the user can rename or replace. Demonstrates the db.js pattern.

```javascript
import { Router } from 'express';
import pool from '../db.js';

const router = Router();

router.get('/', async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM items ORDER BY created_at DESC');
  res.json(rows);
});

router.post('/', async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
  const { rows } = await pool.query(
    'INSERT INTO items (name) VALUES ($1) RETURNING *',
    [name.trim()]
  );
  res.status(201).json(rows[0]);
});

router.delete('/:id', async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM items WHERE id = $1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'Not found' });
  res.status(204).end();
});

export default router;
```

### 2.5 `backend/migrations/1_create_items.sql`

Plain SQL migration file. `node-pg-migrate` uses the `-- Up Migration` / `-- Down Migration` comment markers to separate the two directions.

```sql
-- Up Migration
CREATE TABLE items (
  id         SERIAL PRIMARY KEY,
  name       TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Down Migration
DROP TABLE items;
```

Note: `search_path` is set at connection time (via `DB_SCHEMA`), so all DDL automatically lands in the right schema — no `SET search_path` needed in migration files.

`node-pg-migrate` tracks applied migrations in a `pgmigrations` table it creates automatically in the target schema.

To create additional migrations: `npm run migrate:create -- <name>` generates a new timestamped `.sql` file in `backend/migrations/`.

To apply migrations: `npm run migrate:up` (run this once after the Dev Container starts for the first time).

### 2.6 `backend/.env`

```
DATABASE_URL=postgres://appuser:devpassword@db:5432/<USER_DB>
DB_SCHEMA=<APP_SCHEMA>
```

Note: `db` is the Docker Compose service name — correct when running inside the Dev Container. For running outside the Dev Container, change `db` to `localhost` and adjust the port if needed.

### 2.7 `backend/.env.example`

```
DATABASE_URL=postgres://appuser:devpassword@db:5432/<USER_DB>
DB_SCHEMA=<APP_SCHEMA>
# DB_HOST, DB_NAME, DB_USER are set automatically by deploy-cloudrun — do not set these locally
```

### 2.8 `backend/Dockerfile`

```dockerfile
# Stage 1: Install dependencies
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# Stage 2: Production image
FROM node:20-alpine
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 3001
CMD ["node", "src/index.js"]
```

### 2.9 `backend/.dockerignore`

```
node_modules
.env
*.log
```

---

## Step 3: Write Frontend Files

### 3.1 `frontend/package.json`

```json
{
  "name": "<APP_NAME>-frontend",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.2.1",
    "vite": "^5.0.0"
  }
}
```

### 3.2 `frontend/vite.config.js`

```javascript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
});
```

The proxy forwards `/api` calls to the backend during local dev. When deployed to Cloud Run, `VITE_API_URL` replaces the need for this proxy — the app calls the backend directly by its full URL.

### 3.3 `frontend/index.html`

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title><APP_NAME></title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

### 3.4 `frontend/src/main.jsx`

```jsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

### 3.5 `frontend/src/App.jsx`

The `API_BASE` pattern is pre-wired. All API calls use `${API_BASE}/api/...`. Locally `VITE_API_URL` is unset so `API_BASE` is `''`, making calls relative — picked up by Vite's proxy. On Cloud Run it's the backend service URL.

```jsx
import { useState, useEffect } from 'react';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

export default function App() {
  const [items, setItems] = useState([]);
  const [input, setInput] = useState('');

  useEffect(() => {
    fetch(`${API_BASE}/api/items`)
      .then(r => r.json())
      .then(setItems)
      .catch(console.error);
  }, []);

  async function addItem(e) {
    e.preventDefault();
    if (!input.trim()) return;
    const res = await fetch(`${API_BASE}/api/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: input.trim() }),
    });
    const item = await res.json();
    setItems(prev => [item, ...prev]);
    setInput('');
  }

  async function deleteItem(id) {
    await fetch(`${API_BASE}/api/items/${id}`, { method: 'DELETE' });
    setItems(prev => prev.filter(i => i.id !== id));
  }

  return (
    <div style={{ maxWidth: 480, margin: '2rem auto', fontFamily: 'sans-serif' }}>
      <h1><APP_NAME></h1>
      <form onSubmit={addItem} style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="New item..."
          style={{ flex: 1, padding: '6px 10px' }}
        />
        <button type="submit">Add</button>
      </form>
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {items.map(item => (
          <li key={item.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #eee' }}>
            <span>{item.name}</span>
            <button onClick={() => deleteItem(item.id)} style={{ cursor: 'pointer' }}>✕</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

### 3.6 `frontend/Dockerfile`

```dockerfile
# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

# Stage 2: Serve with nginx
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

The `ARG VITE_API_URL` / `ENV VITE_API_URL` lines are required for `deploy-cloudrun` to bake the backend URL into the Vite build via `--set-build-env-vars`. They are pre-wired here so no Dockerfile modification is needed at deploy time.

### 3.7 `frontend/nginx.conf`

```nginx
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

### 3.8 `frontend/.dockerignore`

```
node_modules
dist
.env
*.log
```

---

## Step 4: Write Dev Container and Docker Compose

### 4.1 `.devcontainer/devcontainer.json`

```json
{
  "name": "<APP_NAME>",
  "dockerComposeFile": "docker-compose.yml",
  "service": "app",
  "workspaceFolder": "/workspace",
  "features": {
    "ghcr.io/devcontainers/features/node:1": { "version": "20" }
  },
  "postCreateCommand": "cd backend && npm install && cd ../frontend && npm install",
  "forwardPorts": [3001, 5173, 5432],
  "portsAttributes": {
    "3001": { "label": "Backend API" },
    "5173": { "label": "Frontend" },
    "5432": { "label": "PostgreSQL" }
  }
}
```

### 4.2 `.devcontainer/docker-compose.yml`

```yaml
services:
  app:
    image: mcr.microsoft.com/devcontainers/base:ubuntu
    volumes:
      - ..:/workspace:cached
    command: sleep infinity
    environment:
      - DATABASE_URL=postgres://appuser:devpassword@db:5432/<USER_DB>
      - DB_SCHEMA=<APP_SCHEMA>
    depends_on:
      db:
        condition: service_healthy

  db:
    image: postgres:15
    environment:
      POSTGRES_DB: <USER_DB>
      POSTGRES_USER: appuser
      POSTGRES_PASSWORD: devpassword
    volumes:
      - postgres-data:/var/lib/postgresql/data
      - ./init.sql:/docker-entrypoint-initdb.d/01-init.sql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U appuser -d <USER_DB>"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  postgres-data:
```

### 4.3 `.devcontainer/init.sql`

Creates the schema and grants the local user access to it. Postgres runs this automatically on first startup via `docker-entrypoint-initdb.d`.

```sql
CREATE SCHEMA IF NOT EXISTS <APP_SCHEMA>;
GRANT ALL ON SCHEMA <APP_SCHEMA> TO appuser;
ALTER ROLE appuser SET search_path = <APP_SCHEMA>;
```

The `ALTER ROLE appuser SET search_path` means the Dev Container database mirrors Cloud SQL exactly: `SELECT * FROM items` resolves to `<APP_SCHEMA>.items` in both environments.

---

## Step 5: Write Root Files

### 5.1 `.gitignore`

```
# Dependencies
node_modules/

# Environment
.env
.env.local

# Build output
dist/
build/

# Logs
*.log

# OS
.DS_Store
```

### 5.2 `README.md`

```markdown
# <APP_NAME>

Express + PostgreSQL + React/Vite starter, pre-wired for the ORM playground.

## Local development

### Option A: Dev Container (recommended)

Open in VS Code and click **Reopen in Container**. Postgres starts automatically.
Then run:

```bash
# Apply migrations (first time only)
cd backend && npm run migrate:up

# Terminal 1
cd backend && npm run dev

# Terminal 2
cd frontend && npm run dev
```

Frontend: http://localhost:5173
Backend: http://localhost:3001

### Option B: Local Node + local Postgres

```bash
# Start Postgres and create the schema manually, then:
cd backend && cp .env.example .env   # edit DB connection if needed
npm run dev

# In another terminal:
cd frontend && npm run dev
```

## Deploy to playground

Run `/deploy-cloudrun` in Claude Code from the repo root.

## Project structure

\`\`\`
<APP_NAME>/
├── .devcontainer/         # Dev Container config + local Postgres
├── backend/
│   ├── src/
│   │   ├── db.js          # Schema-aware dual-mode connection
│   │   ├── index.js       # Express entry point
│   │   └── routes/
│   │       └── items.js   # Starter CRUD route — rename or replace
│   ├── migrations/        # Database migrations (node-pg-migrate, plain SQL)
│   └── Dockerfile
└── frontend/
    ├── src/
    │   ├── App.jsx        # Uses API_BASE for cloud-compatible fetch calls
    │   └── main.jsx
    └── Dockerfile         # Includes ARG VITE_API_URL for cloud builds
\`\`\`

## Database model

- Local: Postgres database `<USER_DB>`, schema `<APP_SCHEMA>`
- Cloud: Cloud SQL instance `playground-postgres`, same database and schema
- Tables land in `<APP_SCHEMA>` in both environments — `search_path` is set at connection time
```

---

## Step 6: Install Dependencies and Init Git

### 6.1 Install npm dependencies

```bash
cd backend && npm install && cd ..
cd frontend && npm install && cd ..
```

### 6.2 Initialise git

```bash
git init
git add .
git commit -m "chore: scaffold <APP_NAME> — Express + PostgreSQL + React/Vite"
```

---

## Step 7: Report

Tell the user:

> "✅ Your app is ready at `./<APP_NAME>/`.
>
> **To start developing:**
>
> 1. Open `./<APP_NAME>/` in VS Code
> 2. When prompted, click **Reopen in Container** (or run Dev Containers: Reopen in Container from the command palette)
> 3. Once inside the container, open two terminals:
>    - Run `cd backend && npm run migrate:up` to apply the initial migration (first time only)
>    - `cd backend && npm run dev`
>    - `cd frontend && npm run dev`
> 4. Open http://localhost:5173 — you should see a working app
>
> The starter has one API route (`/api/items`), one migration (`backend/migrations/1_create_items.sql`), and one React component. Rename or replace them as you build.
>
> **When ready to deploy:** run `/deploy-cloudrun` from the repo root. No changes needed — the project is already wired for it."
