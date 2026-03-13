# Database Migrations Design

**Date:** 2026-03-13
**Project:** todo2
**Topic:** Wire up node-pg-migrate for manual database migrations

## Overview

Add `node-pg-migrate` to the backend to manage database schema changes as versioned migration files. Migrations are run manually by the developer. The first migration converts the existing `schema.sql` into a versioned migration file.

## Goals

- Replace `backend/schema.sql` with a proper migration-based workflow
- Work identically in the Dev Container (local) and against Cloud SQL (production)
- Keep it simple: no automatic migration on startup or deploy

## Non-Goals

- Automatic migration on app startup
- Automatic migration on Cloud Run deploy
- CI/CD integration

## Dependencies

- `node-pg-migrate` added as a devDependency in `backend/package.json`

## npm Scripts

Three scripts added to `backend/package.json`:

| Script | Command | Purpose |
|---|---|---|
| `migrate:up` | `node-pg-migrate up --schema $DB_SCHEMA` | Apply all pending migrations |
| `migrate:down` | `node-pg-migrate down --schema $DB_SCHEMA` | Roll back the last migration |
| `migrate:create` | `node-pg-migrate create --schema $DB_SCHEMA` | Create a new timestamped migration file |

`--schema $DB_SCHEMA` ensures all migrations run in the correct Postgres schema in both local and cloud environments. `DB_SCHEMA` is already set in `backend/.env` (locally) and injected by `deploy-cloudrun` in production.

## Migration Files

- Location: `backend/migrations/`
- Format: JS files with `exports.up` and `exports.down` functions
- First migration: `1_create_items.js` — creates the `items` table (extracted from `schema.sql`)

### First migration (`1_create_items.js`)

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

`node-pg-migrate` tracks applied migrations in a `pgmigrations` table created automatically in the target schema.

## File Changes

| File | Action |
|---|---|
| `backend/package.json` | Add `node-pg-migrate` devDependency + three scripts |
| `backend/migrations/1_create_items.js` | New — initial migration |
| `backend/schema.sql` | Delete — superseded by migrations |

## Developer Workflow

### First time (new Dev Container or new environment)

```bash
cd backend
npm run migrate:up
```

### Adding a new migration

```bash
cd backend
npm run migrate:create -- my-migration-name
# edit the generated file in backend/migrations/
npm run migrate:up
```

### Rolling back

```bash
cd backend
npm run migrate:down
```

### Against Cloud SQL

Connect via Cloud SQL proxy (or from within a Cloud Run job), then run `npm run migrate:up` with the appropriate `DATABASE_URL` and `DB_SCHEMA` env vars set.

## Environment Variables

No new environment variables required. The existing `DATABASE_URL` and `DB_SCHEMA` values in `backend/.env` are sufficient.

## Migration Tracking

`node-pg-migrate` automatically creates and manages a `pgmigrations` table in the target schema. This table records which migrations have been applied and when. No manual setup required.
