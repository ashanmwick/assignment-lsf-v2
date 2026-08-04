# Train Seat Booking

## Running the project

### Docker — one command (recommended)

Prerequisites: Docker Desktop (or Docker Engine + Compose). Both `docker
compose up` and the older hyphenated `docker-compose up` work — they read
the same `docker-compose.yml`.

```bash
docker-compose up --build
```

This single command:

- Starts a local Postgres 16 container with the `btree_gist` extension
  available (the same extension the hosted Supabase instance also uses —
  nothing in the schema is Supabase-specific).
- Runs the database migration, then the seed script, as one-shot jobs
  before anything else starts. Both are idempotent, so re-running
  `docker-compose up` at any time is safe — it won't duplicate data or
  error on already-applied migrations.
- Starts the backend API on `http://localhost:4000` and the built
  frontend on `http://localhost:5173`.

Once it's up, open **http://localhost:5173** and book a seat.

To stop everything:

```bash
docker-compose down
```

### Local (without Docker)

Prerequisites: Node.js 18+, a [Supabase](https://supabase.com) account (or
any reachable Postgres 14+ with the `btree_gist` extension available).

1. **Create a Supabase project** (free tier is fine), or point at your own
   Postgres instance.
2. **Enable the extension** — in the Supabase SQL editor (or via `psql`),
   run:
   ```sql
   CREATE EXTENSION IF NOT EXISTS btree_gist;
   ```
   (The migration also runs this itself, so this is really just a
   convenience/sanity check.)
3. **Get the connection string** — in Supabase: Project Settings →
   Database → Connection string → **URI**. Use the **direct connection
   (port 5432)**, not the Supavisor pooler (port 6543), for running
   migrations.
4. **Backend:**
   ```bash
   cd backend
   cp .env.example .env
   # edit .env and set DATABASE_URL to your connection string
   npm install
   npm run migrate
   npm run seed
   npm run dev
   ```
   The API starts on `http://localhost:4000` (configurable via `PORT` in
   `.env`). If `DATABASE_URL` isn't set, the server fails immediately with
   a clear error instead of defaulting to anything.
5. **Frontend** (separate terminal):
   ```bash
   cd frontend
   cp .env.example .env
   # edit .env if the backend isn't running on the default URL
   npm install
   npm run dev
   ```
   Opens on `http://localhost:5173` by default.
6. Open the frontend, pick a date/leg/train, and book a seat.

`npm run migrate` and `npm run seed` are both safe to re-run — migrations
are tracked in their own table, and the seed script checks what already
exists before writing anything.


## Repo layout

```
backend/    Express API, migrations, seed script, Dockerfile
frontend/   React + Vite frontend, Dockerfile (multi-stage: build -> nginx)
scripts/    Black-box concurrency test
docker-compose.yml   Local Postgres + migrate/seed (one-shot) + backend + frontend
```
