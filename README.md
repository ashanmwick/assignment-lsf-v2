# Colombo Fort–Badulla Segment-Based Seat Booking

A booking system for Sri Lanka's Colombo Fort–Badulla line that lets a single
reserved seat be sold to multiple passengers for different, non-overlapping
legs of the same journey — e.g. one passenger books Colombo Fort → Kandy and
another books Kandy → Badulla on the same physical seat, each paying only for
the distance they travel.

Stack: **Node.js + TypeScript + Express + `pg`** (hand-written SQL, no ORM)
on the backend, **Postgres via Supabase**, **React + TypeScript + Vite** on
the frontend.

## Design decisions

### Segment-as-interval, not per-station booleans

The obvious first model is a boolean per seat per station ("is this seat
occupied at station N?"). It was rejected: a booking isn't really a set of
independent per-station facts, it's a single event with a start and an end,
and the thing you actually need to answer — "do these two bookings
overlap?" — is a **range-intersection question**. Modeling it as a table of
per-station booleans turns that into an O(stations) scan and loses the
ability to express the constraint declaratively at all; you'd have to write
and trust application code to loop over every station in the leg and check
each one, for every concurrent request, with no help from the database.

Instead, a booking stores `origin_seq` and `destination_seq` — the trip
stop's ordinal position, not raw station IDs — and occupancy is the
half-open interval `[origin_seq, destination_seq)`. Two bookings on the same
seat conflict iff their intervals intersect. Postgres has a native type and
operator for exactly this (`int4range`, `&&`), which is what makes the next
decision possible.

### `EXCLUDE USING gist`, not application-level locking

The core requirement is: under concurrent requests, no two active bookings
on the same seat/trip may have overlapping ranges. There are three ways to
guarantee that:

1. **Application-level locking** (e.g. `SELECT ... FOR UPDATE` on the seat,
   or a mutex per seat in the app process). Works only within a single
   process/instance; the moment you run more than one API instance (which
   any real deployment will), two processes can both pass the check before
   either writes.
2. **A distributed lock** (Redis, etc.) — solves the multi-instance problem,
   but now correctness depends on a *second* system staying up, correctly
   configured, and race-free with the database itself. It's an entire extra
   failure mode to reason about, for a guarantee Postgres can already give
   for free.
3. **A database constraint.** `EXCLUDE USING gist` on `booking` declares the
   invariant once, in the schema, and Postgres enforces it for every writer,
   from every process, always — the same way a `UNIQUE` constraint does, just
   over range overlap instead of equality.

Option 3 is what's implemented:

```sql
EXCLUDE USING gist (
  seat_id WITH =,
  trip_id WITH =,
  int4range(origin_seq, destination_seq) WITH &&
) WHERE (status IN ('held', 'confirmed'))
```

This requires the `btree_gist` extension (to let a GiST index handle the
plain-equality `seat_id`/`trip_id` columns alongside the range operator) and
is enabled as the first line of the migration.

**What happens on a race, concretely:** two requests both pass the
application-level "is this seat free?" read, both start a transaction, and
both attempt `INSERT INTO booking (...)`. Postgres serializes the two
inserts; the second one to actually commit finds its new row would overlap
the first and rejects the insert with SQLSTATE **`23P01`**
(`exclusion_violation`). The API layer catches that specific code
(`backend/src/services/bookings.ts`, `isPgError(err) && err.code ===
PG_EXCLUSION_VIOLATION`) and turns it into a clean `409 Conflict` with a
message naming the seat — the raw Postgres error and constraint name are
never sent to the client, only logged. [`scripts/concurrency-test.mjs`](scripts/concurrency-test.mjs)
exercises this directly: it fires two concurrent `POST /api/bookings` for
the same seat and overlapping leg and asserts exactly one 201 and one 409
come back.

The other constraints on `booking` (the composite FKs to `seat`,
`trip_coach`, and `trip_stop`, plus the `origin_seq < destination_seq`
check) exist for the same reason: they're declarative guarantees that don't
depend on application code remembering to check them. See `schema-v1.md`
for the full reasoning per constraint.

### Modular monolith, not microservices

The overlap check has to happen inside the same transaction as the insert,
against the same database that holds every other seat's bookings — that's
what makes the `EXCLUDE` constraint able to guarantee correctness at all. If
booking creation were split across services (e.g. a "seat service" and a
"booking service" talking over the network), the overlap check and the
write could no longer share one transaction, and you'd be back to needing a
distributed lock or a saga/compensation flow to fake atomicity that Postgres
already gives for free within one database. A single backend process talking
to one Postgres database keeps "check and reserve" atomic by construction.
Nothing about this system has an independent scaling or ownership boundary
that would justify paying that cost — it's one bounded problem (trip/seat
booking), so it's one service.

### `held` status, `held_until`, and reconciling expired holds

Booking is two-phase: `POST /api/bookings` creates a `held` row (default 7
minutes, `HOLD_DURATION_MINUTES`) so a seat is provisionally reserved while
a passenger "pays" (`POST /api/bookings/:id/confirm` — no real payment
integration, see Scoped out). This is what most real booking systems do:
show the seat as unavailable to everyone else the instant it's selected, not
only once payment clears.

The subtlety: the `EXCLUDE` constraint's `WHERE (status IN ('held',
'confirmed'))` predicate only knows about `status`. It has no idea what
`held_until` means or that a `held` row might be stale — Postgres doesn't
evaluate time-based conditions as part of an index constraint. So an
**expired-but-still-`held`** row would silently keep blocking new bookings
on that seat/segment forever unless something explicitly flips its status.
Two mechanisms handle this:

1. **Lazy sweep on the hot path** (`services/bookings.ts`,
   `createHeldBooking`): immediately before the `INSERT`, in the *same*
   transaction, run
   `UPDATE booking SET status = 'cancelled' WHERE status = 'held' AND
   held_until < now() AND trip_id = $1 AND seat_id = $2`. This guarantees
   that whatever else is going on, an expired hold on the *specific* seat
   someone is trying to book right now never falsely blocks them — even if
   the background sweeper hasn't ticked yet.
2. **Background sweeper** (`src/sweeper.ts`): a `setInterval` (default every
   30s, `SWEEPER_INTERVAL_SECONDS`) that cancels *all* globally expired
   holds, so `GET .../availability` reads and any future admin/reporting
   view stay accurate even when nobody happens to be actively booking that
   seat. A `setInterval` in the API process is adequate for this scope; a
   real deployment would run this as a proper scheduled job (e.g.
   `pg_cron`, or a queue worker tick) so it survives process restarts and
   doesn't run once per instance if the API is horizontally scaled.

### Fare calculation

`fare = (destination.distance_km - origin.distance_km) * rate_per_km`, where
`rate_per_km` comes from `fare_rule` keyed by the seat's coach's
`coach_type`. The result is written once to `booking.fare` at creation time
and never recomputed — if `fare_rule` rates change later, historical
bookings must keep showing what the passenger actually paid.

### Configurability

Number of coaches, seats per coach, and stations on the route are seed
data (`backend/scripts/seed.ts`), not constants in application logic. The
API and frontend never assume "3 reserved coaches" or "20 stations"
anywhere — they render and query whatever is actually in `coach`, `seat`,
and `route_station`. Extending the route or adding coaches later is a data
change, not a code change.

## Scoped out (and why)

- **Unreserved-coach seat assignment.** Unreserved coaches are
  first-come-first-served by design (per the assignment brief) — there's no
  seat-level concept to book. They're seeded and attached to the trip via
  `trip_coach` (so occupancy/coach-count reporting could reference them
  later) but the API only returns seat-level availability for `reserved`
  coaches; unreserved coaches show up in the availability response as a
  coach entry with an empty `seats` array and a passenger-facing note in the
  UI.
- **Payment integration.** `POST /api/bookings/:id/confirm` is a stand-in
  for "payment succeeded" — no payment provider is wired in. Confirming is
  just the second half of the two-phase hold/confirm flow described above.
- **Authentication.** `Passenger` records are created ad hoc
  (`POST /api/passengers`) with just a name/email — there's no login,
  session, or ownership check on who can confirm/cancel a given booking.
  Real deployment would need this; it's out of scope for demonstrating the
  concurrency model, which is the point of the exercise.
- **Docker / containerized deployment.** Deliberately deferred to a
  follow-up pass. Everything runs as local processes (`npm run dev`) against
  the hosted Supabase database purely through `DATABASE_URL`, so
  containerizing later doesn't require touching any application code.
- **Extra Credit features** (seat map polish, admin view, waitlisting,
  etc.) — not built in this pass. Priority was a correct, fully-working core
  flow (schema → API → concurrency proof → frontend) over a longer feature
  list; see `Assignment_LSF_SE_Interview_2026.md`'s "Focus" note.

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/routes/:routeId/stations` | Ordered stations on a route |
| GET | `/api/trips?routeId=&date=` | List trips, optionally filtered |
| GET | `/api/trips/:tripId` | Trip detail |
| GET | `/api/trips/:tripId/availability?origin=&destination=` | Per-seat availability for a leg |
| POST | `/api/passengers` | Create a passenger (`{ name, email? }`) |
| POST | `/api/bookings` | Create a `held` booking |
| POST | `/api/bookings/:id/confirm` | `held` → `confirmed` |
| DELETE | `/api/bookings/:id` | Cancel (`held` or `confirmed` → `cancelled`) |
| GET | `/api/bookings/:id` | Booking detail |

All responses are camelCase JSON. Errors are `{ "error": "message" }` with
an appropriate status code (`400`, `404`, `409`, `500`); raw Postgres errors
are never returned to the client.

## Setup (clean machine)

Prerequisites: Node.js 18+, a [Supabase](https://supabase.com) account.

1. **Create a Supabase project** (free tier is fine).
2. **Enable the extension** — in the Supabase SQL editor, run:
   ```sql
   CREATE EXTENSION IF NOT EXISTS btree_gist;
   ```
   (The migration also runs this itself, so this step is really a
   convenience/sanity check — either way it needs to happen before the
   `EXCLUDE` constraint can be created.)
3. **Copy the direct connection string** — Project Settings → Database →
   Connection string → **URI**, using the **direct connection (port 5432)**,
   not the Supavisor pooler (port 6543). Migrations/DDL should run against
   the direct connection.
4. **Backend env:**
   ```bash
   cd backend
   cp .env.example .env
   # edit .env, set DATABASE_URL to the connection string from step 3
   npm install
   npm run migrate
   npm run seed
   npm run dev
   ```
   The API starts on `http://localhost:4000` (configurable via `PORT`). If
   `DATABASE_URL` isn't set, the server fails immediately with a clear error
   rather than defaulting to anything.
5. **Frontend env** (separate terminal):
   ```bash
   cd frontend
   cp .env.example .env
   # edit .env if the backend isn't on the default URL
   npm install
   npm run dev
   ```
   Opens on `http://localhost:5173` by default.
6. Open the frontend, enter a name, pick an origin/destination, and book a
   seat.

`npm run migrate` (node-pg-migrate) and `npm run seed` are both safe to
re-run: migrations are tracked in node-pg-migrate's own `pgmigrations`
table, and the seed script checks whether the "Colombo Fort–Badulla" route
already exists before writing anything.

## Testing the concurrency guarantee

With the backend running and seeded:

```bash
npm run test:concurrency
```

(from the repo root — see [`scripts/concurrency-test.mjs`](scripts/concurrency-test.mjs)). It fires two
concurrent `POST /api/bookings` for the same seat and a fully-overlapping
leg, and asserts exactly one comes back `201` and the other `409`. It talks
to the API only (no direct DB access), so it exercises the real
transaction + `23P01`-to-409 translation path end to end, then cancels the
winning booking so re-running the script doesn't leave holds behind.

## Repo layout

```
backend/    Express API, migrations, seed script
frontend/   React + Vite frontend
scripts/    Black-box concurrency test
```

## Not yet done

Docker/containerized setup and any Extra Credit features are deliberately
not part of this pass — see "Scoped out" above.
