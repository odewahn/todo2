# Database Migrations Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire up `node-pg-migrate` for manual schema migrations, replacing `backend/schema.sql` with a versioned migration file.

**Architecture:** Add `node-pg-migrate` as a devDependency with three npm scripts (`migrate:up`, `migrate:down`, `migrate:create`). Migration files live in `backend/migrations/` using `.cjs` extension (required because `backend/package.json` sets `"type": "module"`). The first migration converts the existing `schema.sql` into a versioned file.

**Tech Stack:** `node-pg-migrate`, PostgreSQL, Node.js (CommonJS `.cjs` migration files inside an ESM package)

---

## Chunk 1: Wire up node-pg-migrate

### File Structure

| Action | Path | Responsibility |
|---|---|---|
| Modify | `backend/package.json` | Add `node-pg-migrate` devDependency + 3 scripts |
| Create | `backend/migrations/20260313000000_create_items.cjs` | Initial migration: creates `items` table |
| Delete | `backend/schema.sql` | Superseded by migrations |

---

### Task 1: Add node-pg-migrate dependency and scripts

**Files:**
- Modify: `backend/package.json`

- [ ] **Step 1: Add devDependency and scripts to `backend/package.json`**

Replace the current contents with:

```json
{
  "name": "todo2-backend",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "node --watch src/index.js",
    "start": "node src/index.js",
    "migrate:up": "node-pg-migrate up --schema $DB_SCHEMA --migrations-dir migrations",
    "migrate:down": "node-pg-migrate down --schema $DB_SCHEMA --migrations-dir migrations",
    "migrate:create": "node-pg-migrate create --schema $DB_SCHEMA --migrations-dir migrations --migration-file-language cjs"
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

- [ ] **Step 2: Install the new dependency**

Run from `backend/`:
```bash
npm install
```

Expected: `node_modules/node-pg-migrate/` appears, `package-lock.json` updated.

- [ ] **Step 3: Verify the CLI is available**

Run from `backend/`:
```bash
npx node-pg-migrate --version
```

Expected: prints a version string like `7.x.x`.

- [ ] **Step 4: Commit**

```bash
git add backend/package.json backend/package-lock.json
git commit -m "chore: add node-pg-migrate devDependency and scripts"
```

---

### Task 2: Create the initial migration

**Files:**
- Create: `backend/migrations/20260313000000_create_items.cjs`

- [ ] **Step 1: Create the migrations directory and first migration file**

Create `backend/migrations/20260313000000_create_items.cjs` with these contents:

```js
exports.up = (pgm) => {
  pgm.createTable('items', {
    id: { type: 'serial', primaryKey: true },
    name: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
};

exports.down = (pgm) => {
  pgm.dropTable('items');
};
```

- [ ] **Step 2: Run migrate:up to verify the migration applies cleanly**

> **Note — existing Dev Container volumes:** If you previously applied `schema.sql` by hand, the `items` table already exists and `migrate:up` will fail with a duplicate table error. Resolve by destroying the Docker volume and recreating: `docker compose down -v` from `.devcontainer/`, then reopen the container. This gives you a clean database.

From `backend/` (inside the Dev Container, or with `DATABASE_URL` and `DB_SCHEMA` set):
```bash
npm run migrate:up
```

Expected output (approximate):
```
> node-pg-migrate up ...
Migrating files:
- 20260313000000_create_items
Running migration 20260313000000_create_items (up)
Migrations complete!
```

Verify by connecting to the database and checking:
```sql
SELECT * FROM pgmigrations;
-- should show one row: 20260313000000_create_items
SELECT * FROM items;
-- should show empty table (no error)
```

- [ ] **Step 3: Run migrate:down to verify rollback works**

```bash
npm run migrate:down
```

Expected output:
```
Running migration 20260313000000_create_items (down)
Migrations complete!
```

Verify: `items` table is gone, `pgmigrations` is empty.

- [ ] **Step 4: Run migrate:up again to restore**

```bash
npm run migrate:up
```

Expected: migration applies again cleanly. Database is back to having the `items` table.

- [ ] **Step 5: Commit**

```bash
git add backend/migrations/
git commit -m "feat: add initial migration for items table"
```

---

### Task 3: Remove schema.sql

**Files:**
- Delete: `backend/schema.sql`

- [ ] **Step 1: Delete schema.sql**

```bash
git rm backend/schema.sql
```

- [ ] **Step 2: Update README.md to reflect the change**

In `README.md`, find the project structure section and update the backend description. Replace any mention of `schema.sql` with a reference to `migrations/`:

```markdown
├── backend/
│   ├── src/
│   │   ├── db.js          # Schema-aware dual-mode connection
│   │   ├── index.js       # Express entry point
│   │   └── routes/
│   │       └── items.js   # Starter CRUD route — rename or replace
│   ├── migrations/        # Database migrations (node-pg-migrate)
│   └── Dockerfile
```

Also update the "Local development" section to mention running `npm run migrate:up` after container startup. The updated section should read:

    ### Option A: Dev Container (recommended)

    Open in VS Code and click **Reopen in Container**. Postgres starts automatically.
    Then in two terminals:

        # Terminal 1 — apply migrations (first time only, or after adding new ones)
        cd backend && npm run migrate:up

        # Terminal 2 — start the backend
        cd backend && npm run dev

        # Terminal 3 — start the frontend
        cd frontend && npm run dev

- [ ] **Step 3: Commit**

(`backend/schema.sql` was already staged by `git rm` in Step 1 — no need to re-add it.)
```bash
git add README.md
git commit -m "chore: remove schema.sql, now managed by migrations"
```

---

## Usage Reference (for developers)

### First time setup
```bash
cd backend && npm run migrate:up
```

### Create a new migration
```bash
cd backend
npm run migrate:create -- your-migration-name
# Edit the generated file in backend/migrations/
npm run migrate:up
```

### Roll back last migration
```bash
cd backend && npm run migrate:down
```

### Run against Cloud SQL
Start the Cloud SQL Auth Proxy locally, then:
```bash
export DATABASE_URL=postgres://<user>:<password>@localhost:5432/<db-name>
export DB_SCHEMA=todo2
cd backend && npm run migrate:up
```
