# todo2

Express + PostgreSQL + React/Vite starter, pre-wired for the ORM playground.

## Local development

### Option A: Dev Container (recommended)

Open in VS Code and click **Reopen in Container**. Postgres starts automatically.
Then in two terminals:

```bash
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

```
todo2/
├── .devcontainer/         # Dev Container config + local Postgres
├── backend/
│   ├── src/
│   │   ├── db.js          # Schema-aware dual-mode connection
│   │   ├── index.js       # Express entry point
│   │   └── routes/
│   │       └── items.js   # Starter CRUD route — rename or replace
│   ├── schema.sql         # Table definitions
│   └── Dockerfile
└── frontend/
    ├── src/
    │   ├── App.jsx        # Uses API_BASE for cloud-compatible fetch calls
    │   └── main.jsx
    └── Dockerfile         # Includes ARG VITE_API_URL for cloud builds
```

## Database model

- Local: Postgres database `odewahn`, schema `todo2`
- Cloud: Cloud SQL instance `playground-postgres`, same database and schema
- Tables land in `todo2` in both environments — `search_path` is set at connection time
