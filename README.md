# Train Seat Booking

## Running the project

### Docker — one command (recommended)

Prerequisites: Docker Desktop (or Docker Engine + Compose). Both `docker
compose up` and the older hyphenated `docker-compose up` work — they read
the same `docker-compose.yml`.

```bash
docker-compose up --build
```

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


## Design decisions and reasoning
 
### 1. Data model: half-open intervals, not per-station flags

In this system seat occupancy is modeled as a range `[origin_seq, destination_seq)` over a
trip's stop sequence, rather than a boolean per station the seat passes
through. A passenger going Colombo Fort → Kandy occupies the seat for
`[0, 8)`; a later passenger going Kandy → Badulla occupies `[8, 19)`. These
don't overlap, so both bookings can stand on the same seat without any issue.
 
The alternative — a row per seat per station, flipped to "occupied" for
every station the passenger passes — works but turns every booking and
every availability check into an operation over N station-rows instead of
one range comparison, and turns overlap detection into application code
that has to reason about a set of flags instead of letting the database
compare two intervals directly. Ranges also compose naturally with
Postgres's built-in range types and GiST indexing (below), which per-station
flags don't.
 
`sequence` (not distance or time) is the unit ranges are expressed in,
because it's what "overlap" actually means here: two legs conflict iff
they share a stop, regardless of the distance or time between stops.

| | Range model (`[origin_seq, dest_seq)`) | Per-station flags |
|---|---|---|
| **Rows per booking** | 1 | One per station passed (8–19) |
| **Overlap check** | 1 range comparison | Loop over every shared station |
| **Who enforces it** | Postgres `EXCLUDE` + GiST index | Application code you write |
| **Race-condition safety** | Guaranteed by the DB constraint | Depends on your locking logic |
| **Adjacent bookings (e.g. both "touch" Kandy)** | Handled natively via half-open intervals | Must hand-code the arrival-vs-departure rule |
| **Failure mode on partial write** | Single INSERT, atomic | Multi-row batch can fail halfway through |
| **Scales with trip length** | Constant (1 row regardless of stops) | Grows linearly with number of stops |

![Range model vs per-station flags](docs/images/range-vs-perstation.png)


### 2. Concurrency: a database-level `EXCLUDE` constraint, not application locks
Two people might try to book the same seat, on the same trip, for overlapping
parts of the journey, at the same time. Only one should win.

### The fix: let Postgres enforce it, not our code
We add a special database rule (an `EXCLUDE` constraint) that says:
 
> "For the same seat and the same trip, no two active bookings are allowed
> to have overlapping travel ranges."
 
Postgres checks this automatically, inside the database, every time a
booking is inserted. We don't have to write that logic ourselves.
 
### Why not do it in the app instead?
Two common alternatives, and why we skipped them:
 
- **Check-then-write in code ("optimistic locking")** — the app reads current
  bookings, checks for overlap, then writes. Works, but it's easy to get
  wrong (miss an edge case, forget a code path) and we'd be rebuilding
  something Postgres already does reliably.
- **A lock in Redis (or similar)** — adds a whole extra system to run and
  keep in sync with the database, and you *still* need the same overlap
  logic underneath it. It just moves the problem, doesn't remove it.
Because the database is the single source of truth for this rule, it can't
be bypassed by a bug elsewhere in the code. This is also the main reason
we built one combined backend (a "modular monolith") instead of splitting
booking into separate microservices — splitting it up would break this
guarantee or make it much weaker.
 
The rule only applies to bookings that are `held` or `confirmed`. Cancelled
bookings don't block anyone.
 
## What happens when two people race for the same seat
Both requests try to insert a booking at the same time.
 
1. Postgres lets the first one succeed.
2. The second one fails with a specific database error (code `23P01`).
3. Our server catches that error and sends the user a clean `409 Conflict`
   response — not a scary raw database error.
4. The frontend sees the `409` and refreshes seat availability right away,
   so the user doesn't see a seat marked "available" that's actually gone.
We have a test script (`scripts/concurrency-test.mjs`) that fires two
overlapping bookings at once and checks that exactly one wins and one gets
rejected.
 
## Holding a seat before you confirm it
When someone selects a seat, we don't wait until final checkout to reserve
it. Instead we immediately create a `held` booking with an expiry time
(`held_until`, default 7 minutes). This uses the *same* database rule above
— no separate mechanism needed.
 
This is the same pattern airlines and ticket sites (like Ticketmaster) use:
reserve the seat the moment it's picked, so if there's a conflict, the user
finds out right away instead of after filling in payment details.
 
### Cleaning up expired holds
If someone holds a seat and doesn't finish booking, that hold needs to go
away eventually so others can use the seat. We handle this two ways:
 
- **Right before booking that seat**: if there's an expired hold sitting on
  the exact seat someone is trying to book, we clear it first — so it never
  blocks a real request, even if the cleanup job hasn't run yet.
- **A background job** that runs every 30 seconds and clears *all* expired
  holds everywhere. This keeps things accurate for people just browsing
  availability, not actively booking. (For a real production system, this
  job would run as a proper scheduled task like `pg_cron`, so it survives
  restarts and doesn't duplicate itself if we run multiple servers.)

### 3. Configurability
 
The assignment asks for coach counts, seats per coach, and stations to be
configurable rather than hardcoded. Nothing in the backend or frontend
assumes a fixed number of coaches, seats, or stations — those are rows in
`coach`, `seat`, `route_station`, read at query time. `backend/scripts/seed.ts`
centralizes the current line's configuration (20 stations, 3 reserved + 5
unreserved coaches, 44 seats per reserved coach) as data at the top of the
file; extending the route or adding coaches means editing that data (or
writing a different seed), not touching API or frontend code.

### 4. Why a modular monolith over microservices
 
Segment-overlap checking needs the same transaction to see the seat's
current bookings and commit the new one atomically — that's exactly what
the `EXCLUDE` constraint depends on. Splitting booking, availability, and
fare calculation into separately-deployed services would force a choice
between calling back into one shared database anyway (in which case the
service boundary adds latency and complexity without adding independence)
or maintaining separate data stores kept eventually consistent (in which
case double-booking becomes possible during the inconsistency window,
which this system cannot tolerate). A modular monolith — one deployable,
internally organized into `routes/` and `services/` by responsibility —
gets the code organization benefit of separated concerns without giving up
the transactional guarantee the whole system depends on.



## Extra credit implemented
 
- **Seat map visualization** (`frontend/src/components/SeatMap.tsx`) — a
  real grid of seats per coach, laid out by row/column, colored by
  availability status for the currently-selected leg.
- **Real-time-feeling conflict handling** — the frontend disables the seat
  map synchronously on the first click (before the request resolves) to
  close the window where a burst of clicks could fire multiple concurrent
  holds that the UI can't track; on a `409` it shows a clear "someone else
  just booked that seat" message and immediately refreshes availability
  instead of leaving a stale seat map on screen. A live countdown on the
  hold (`BookingPanel.tsx`) shows the passenger exactly how long they have
  before the hold expires, and releases the seat automatically if it does.
- **Scheduled arrival/departure times** end-to-end — station pickers, the
  seat map header, and the booking confirmation all show real times for
  the selected leg (see "Scheduled times" above), not just station names.

## Challenges
 
## 1. Making sure a booking's start/end points are always real stops on the trip
 
- each booking of seat stores an origin and a destination, and each is a
  **station + sequence number** pair.
- Problem: nothing stopped the station and sequence number from pointing
  to different stops — i.e. a "phantom" origin/destination that doesn't
  match a real stop on that trip.
- But the fix couldn't be so strict it rejected valid bookings.
- **Solution:** require the origin's (station, sequence) pair to match one
  real row in the trip's stop list — same for the destination.
- Postgres checks this automatically the moment a booking is inserted.

## 2. Who clears an expired hold, and when
 
- Two approaches considered:
  - Clean up immediately, right when someone else tries to book that same
    seat (narrow, synchronous).
  - Clean up on a schedule in the background (broad, periodic).
- **Decision: do both** — they solve different problems.
  - **Immediate check** → if you're booking a seat right now, any stale
    expired hold on that *exact* seat can't block you.
  - **Background sweep** → keeps everyone else's view of "what's
    available" accurate in general, even for seats nobody's actively
    booking at that moment.

 


## AI tools used
 
- **Claude** — architecture and schema design discussion and drafting documentations.
- **Claude Code** — implementation: migrations, API routes, the booking
  service, the seed script, the frontend, and the concurrency test.
- **ChatGPT** — used alongside the above during development.

## Repo layout

```
.
├── docker-compose.yml          Local Postgres + migrate/seed (one-shot) + backend + frontend
├── .env.example                Optional DATABASE_URL override for docker-compose (point at real Supabase)
├── package.json                Root scripts: npm run test:concurrency
│
├── backend/                    Express API (TypeScript, hand-written SQL via pg)
│   ├── Dockerfile              Single image, reused for migrate/seed/serve via command override
│   ├── .dockerignore
│   ├── .env.example            DATABASE_URL, PORT, CORS_ORIGIN, HOLD_DURATION_MINUTES, SWEEPER_INTERVAL_SECONDS
│   ├── package.json            Scripts
│   ├── tsconfig.json
│   ├── migrations/             node-pg-migrate migration files (raw SQL, no ORM)
│   │   ├── 1706000000000_init.cjs                  Core schema: station/route/trip/coach/seat/booking + EXCLUDE constraint
│   │   └── 1706000100000_add_scheduled_times.cjs   Adds route_station.offset_minutes, trip_stop.scheduled_arrival/departure
│   ├── scripts/
│   │   └── seed.ts             Database population script : stations, route, trains, coaches/seats, fare rules, trips
│   └── src/
│       ├── server.ts           Express app wiring, error middleware, starts the sweeper
│       ├── config.ts           Env-driven config (port, CORS origin, hold duration, sweeper interval)
│       ├── db.ts                Pool setup, withTransaction() helper, DATABASE_URL fail-fast check
│       ├── errors.ts           AppError + PG_EXCLUSION_VIOLATION (23P01) helpers
│       ├── sweeper.ts          Background job that cancels globally expired 'held' bookings
│       ├── routes/
│       │   ├── stations.ts     GET /api/routes, GET /api/routes/:routeId/stations
│       │   ├── trips.ts        GET /api/trips (date/leg-filtered), GET /api/trips/:id, GET .../availability
│       │   ├── bookings.ts     POST /api/bookings, POST .../confirm, DELETE /api/bookings/:id, GET /api/bookings/:id
│       │   └── passengers.ts   POST /api/passengers
│       └── services/
│           └── bookings.ts     Transactional booking logic: lazy sweep, fare calc, 23P01 -> 409 translation
│
├── frontend/                   React + TypeScript + Vite
│   ├── Dockerfile               Multi-stage: vite build -> nginx serving the static bundle
│   ├── .dockerignore
│   ├── .env.example             VITE_API_URL
│   ├── package.json
│   ├── vite.config.ts
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx              Top-level flow: date -> origin/destination -> train -> seat -> pay
│       ├── App.css              All app styles (filter bar, train list, seat map, bottom booking bar, modals)
│       ├── index.css            CSS reset + theme variables
│       ├── api.ts               Typed fetch client for the backend API
│       ├── time.ts              Sri Lanka-timezone-aware time/duration formatting helpers
│       └── components/
│           ├── StationPicker.tsx    Origin/destination <select> pair
│           ├── TimeRangePicker.tsx  Departs-after / departs-before filter
│           ├── TrainList.tsx        Clickable list of trains matching the current filters
│           ├── SeatMap.tsx          Coach tabs, legend, seat grid (per-coach availability)
│           ├── PassengerModal.tsx   Name + mobile number, then dummy OTP verification
│           ├── PassengerBadge.tsx   "Booking as X" indicator once a passenger is set
│           └── BookingPanel.tsx     Sticky bottom bar: held/confirmed summary, countdown, Pay Now
│
├── scripts/
│   └── concurrency-test.mjs    Black-box test: races two bookings for the same seat, asserts 201 + 409
│
├── docs/
│   └── DATABASE-SCHEMA.md      Full entity-by-entity schema reference and constraint rationale
│
└── .claude/
    └── launch.json             Dev-server config for the in-editor browser preview (not part of the app)
```

