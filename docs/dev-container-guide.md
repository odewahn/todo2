# Dev Container Guide

## What is a Dev Container?

A Dev Container is a full development environment that runs inside Docker. Instead of installing Node, PostgreSQL, and the Google Cloud CLI on your laptop, everything runs in a container that's defined by code in this repo. Everyone who opens this project gets the same environment.

For this project, the Dev Container gives you:
- Node 20
- A PostgreSQL 15 database (starts automatically, no setup required)
- Google Cloud CLI (for deploying)
- All npm dependencies installed automatically

Your code on disk is mounted into the container, so edits you make in VS Code are immediately reflected inside the container.

## What you need

1. **Docker Desktop** — [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop). Must be running before you open the container.
2. **VS Code** — [code.visualstudio.com](https://code.visualstudio.com)
3. **Dev Containers extension for VS Code** — install it from the Extensions panel (search `ms-vscode-remote.remote-containers`) or from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers).

That's it. You do not need Node, npm, or PostgreSQL installed on your laptop.

## Opening the project in a Dev Container

1. Open the `todo2/` folder in VS Code (`File → Open Folder`).
2. VS Code will detect the `.devcontainer/` folder and show a notification:
   > "Folder contains a Dev Container configuration file. Reopen in Container?"
3. Click **Reopen in Container**.

   If you miss the notification, open the Command Palette (`Cmd+Shift+P` on Mac, `Ctrl+Shift+P` on Windows/Linux) and run:
   > **Dev Containers: Reopen in Container**

4. VS Code will build the container images and start them. This takes a few minutes the first time (it's downloading base images and installing npm packages). Subsequent opens are fast.

5. When it's ready, VS Code's bottom-left corner shows **Dev Container: todo2**. You now have a terminal running inside the container.

## What happens automatically on startup

When the container starts, two things happen without any action from you:

1. **PostgreSQL starts** — a Postgres 15 container starts alongside the app container. It creates the `odewahn` database and the `todo2` schema automatically (via `.devcontainer/init.sql`). The database persists across container restarts in a Docker volume.

2. **npm install runs** — `backend/` and `frontend/` dependencies are installed automatically via `postCreateCommand`.

## First-time setup after the container starts

Once the container is ready, apply the database migrations to create your tables:

```bash
cd backend && npm run migrate:up
```

You only need to do this once (or again after adding new migration files).

## Starting the app

Open two terminals inside VS Code (`` Ctrl+` `` to open, then the `+` button for a second one):

**Terminal 1 — backend:**
```bash
cd backend && npm run dev
```

**Terminal 2 — frontend:**
```bash
cd frontend && npm run dev
```

Then open http://localhost:5173 in your browser. The frontend proxies `/api` calls to the backend at port 3001.

Ports 3001, 5173, and 5432 are forwarded to your laptop automatically, so your browser and any local database tools connect normally.

## Connecting to the database

From inside the container terminal:
```bash
psql $DATABASE_URL
```

From a tool on your laptop (TablePlus, DBeaver, psql, etc.), connect to:
- Host: `localhost`
- Port: `5432`
- Database: `odewahn`
- User: `appuser`
- Password: `devpassword`

## Resetting the database

If you want a clean database (e.g., to replay migrations from scratch):

1. Stop the container: close VS Code or run **Dev Containers: Reopen Folder Locally**.
2. From your laptop terminal, inside the `todo2/` folder:
   ```bash
   docker compose -f .devcontainer/docker-compose.yml down -v
   ```
   The `-v` flag removes the `postgres-data` volume, wiping all data.
3. Reopen in Container — Postgres will reinitialise the schema from scratch.
4. Run migrations again: `cd backend && npm run migrate:up`

## Rebuilding the container

If you change `.devcontainer/devcontainer.json`, `docker-compose.yml`, or install new system-level tools, you need to rebuild the container image:

Command Palette → **Dev Containers: Rebuild Container**

You do not need to rebuild when changing `package.json` — just run `npm install` in the relevant directory.

## How the database connection works

The app connects to Postgres using the `DATABASE_URL` environment variable, which is set in `.devcontainer/docker-compose.yml`:

```
DATABASE_URL=postgres://appuser:devpassword@db:5432/odewahn
DB_SCHEMA=todo2
```

`db` is the hostname of the Postgres container (Docker Compose service name). This resolves automatically inside the container network. Outside the container, Postgres is reachable at `localhost:5432`.

On Cloud Run, `DB_HOST`, `DB_NAME`, and `DB_USER` are used instead (IAM auth via Unix socket). The `backend/src/db.js` file handles both cases transparently.
