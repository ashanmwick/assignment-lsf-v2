# Segment-Based Train Booking — Database Schema

Colombo Fort–Badulla line. Full entity reference, consolidated from design discussion.

---

## Station

Physical, real-world station. Never changes.

| Column | Type | Notes |
|---|---|---|
| `id` | PK | |
| `name` | text | e.g. "Kandy" |
| `code` | text, optional | short code for URLs/display |

---

## Route

Static template — a named path, independent of any specific train run.

| Column | Type | Notes |
|---|---|---|
| `id` | PK | |
| `name` | text | e.g. "Colombo Fort–Badulla" |

---

## RouteStation

Master list of stations/order/distance for a `Route`. `TripStop` is seeded from this at trip-creation time — without it, every new `Trip` would need its stops re-entered from scratch.

| Column | Type | Notes |
|---|---|---|
| `id` | PK | |
| `route_id` | FK → Route | |
| `station_id` | FK → Station | |
| `sequence` | int | ordinal position, strictly increasing |
| `distance_km` | numeric | cumulative from origin |

**Constraint:** `UNIQUE(route_id, station_id)` and `UNIQUE(route_id, sequence)`

---

## Train

Physical train/rake.

| Column | Type | Notes |
|---|---|---|
| `id` | PK | |
| `train_name` | text | e.g. "Podi Menike" |
| `train_number` | text, optional | operational code |

---

## Trip

One scheduled instance of a train running a route on a given day.

| Column | Type | Notes |
|---|---|---|
| `id` | PK | |
| `train_id` | FK → Train | |
| `route_id` | FK → Route | |
| `departure_time` | time | when it leaves the origin station |
| `service_date` | date | calendar date this trip runs |

---

## TripStop

Per-trip source of truth for stops (seeded from `RouteStation`, but not permanently bound to it — a specific trip could in principle skip a stop).

| Column | Type | Notes |
|---|---|---|
| `id` | PK | |
| `trip_id` | FK → Trip | |
| `station_id` | FK → Station | |
| `sequence` | int | ordinal position along this trip; used by booking overlap logic |
| `distance_km` | numeric | cumulative from origin; used by fare calculation |

**Constraint:** `UNIQUE(trip_id, station_id)`, `UNIQUE(trip_id, sequence)`, and `UNIQUE(trip_id, station_id, sequence)` — the three-column constraint is what lets `Booking` reference a `(trip_id, station_id, sequence)` triple as a single composite foreign key, guaranteeing that a station and a sequence number can't be paired together on a booking unless they jointly resolve to one real stop on that trip.

---

## Coach

Physical asset. Doesn't change.

| Column | Type | Notes |
|---|---|---|
| `id` | PK | |
| `coach_number` | text | e.g. "RC-3" |
| `coach_type` | enum | `reserved` / `unreserved` |
| `total_seats` | int | |

---

## Seat

Physical seat, belongs to a coach permanently. Used to render the seat map.

| Column | Type | Notes |
|---|---|---|
| `id` | PK | |
| `coach_id` | FK → Coach | |
| `seat_number` | text | e.g. "14A" |
| `row` | int | grid position, frontend layout only |
| `column` | int | grid position, frontend layout only |
| `seat_type` | text, optional | window / aisle |

**Constraint:** `UNIQUE(coach_id, id)` — redundant as a uniqueness guarantee on its own (`id` is already unique), but required so `coach_id` can participate as the target of a composite foreign key from `Booking`. This is what lets `Booking(coach_id, seat_id)` reference `Seat(coach_id, id)` below.

---

## TripCoach

Binding: which coaches are attached to which trip, and in what order. Coaches get reshuffled between trips even on the same train, so this join table — not a direct FK on `Seat` — is what changes per trip.

| Column | Type | Notes |
|---|---|---|
| `id` | PK | |
| `trip_id` | FK → Trip | |
| `coach_id` | FK → Coach | |
| `position_in_train` | int | order of coaches on this trip |

**Constraint:** `UNIQUE(trip_id, coach_id)` — stops the same coach being attached twice to one trip. Also required as the target of the composite foreign key from `Booking(trip_id, coach_id)` below.

---

## FareRule

Configurable rate, not hardcoded — matches the assignment's "configurable" requirement.

| Column | Type | Notes |
|---|---|---|
| `id` | PK | |
| `coach_type` | enum | `reserved` / `unreserved` |
| `rate_per_km` | numeric | e.g. Rs. 4.50/km |

---

## Passenger

Minimal identity for "who booked this."

| Column | Type | Notes |
|---|---|---|
| `id` | PK | |
| `name` | text | |
| `email` or `phone` | text | contact / login identifier |

---

## Booking

The core transactional record. References `Trip` + `Seat` directly; occupancy is modeled as a half-open interval `[origin_seq, destination_seq)`.

| Column | Type | Notes |
|---|---|---|
| `id` | PK | |
| `trip_id` | FK → Trip | |
| `coach_id` | FK → Coach | denormalized from `Seat.coach_id` at booking time — set once, never updated. Exists to support the composite FKs below, not for general querying convenience. |
| `seat_id` | FK → Seat | |
| `passenger_id` | FK → Passenger | who booked it |
| `origin_station_id` | FK → Station | for display (e.g. "Colombo Fort") |
| `destination_station_id` | FK → Station | for display (e.g. "Kandy") |
| `origin_seq` | int | denormalized copy of `TripStop.sequence` at booking time — used for range/exclusion math |
| `destination_seq` | int | same, for the destination |
| `fare` | numeric | snapshot of computed price at booking time — immutable, doesn't recompute if `FareRule` rates change later |
| `status` | enum | `held` / `confirmed` / `cancelled` |
| `held_until` | timestamp | expiry for `held` status |
| `created_at` | timestamp | |

**Constraints:**

- `EXCLUDE USING gist (seat_id WITH =, trip_id WITH =, int4range(origin_seq, destination_seq) WITH &&)` — the core segment-overlap mechanism. Prevents two bookings on the same seat/trip from having overlapping `[origin_seq, destination_seq)` ranges. Covers `held` bookings too, so conflicts surface at selection time, not just at final confirmation. A losing concurrent insert fails with Postgres error `23P01`, which the API translates into a clean `409 Conflict`.
- `FOREIGN KEY (coach_id, seat_id) REFERENCES Seat(coach_id, id)` — enforces that the seat being booked genuinely belongs to the coach recorded on the booking. Can't be forged or drift apart.
- `FOREIGN KEY (trip_id, coach_id) REFERENCES TripCoach(trip_id, coach_id)` — enforces that the coach is actually attached to this trip.
- `FOREIGN KEY (trip_id, origin_station_id, origin_seq) REFERENCES TripStop(trip_id, station_id, sequence)` — enforces that the origin station and origin sequence number jointly resolve to one real stop on this trip. Without this, `origin_station_id` (used for display) and `origin_seq` (used by the `EXCLUDE` constraint) are two independently-writable fields that could silently disagree — e.g. displaying "Colombo Fort" while the actual held range corresponds to a different station entirely.
- `FOREIGN KEY (trip_id, destination_station_id, destination_seq) REFERENCES TripStop(trip_id, station_id, sequence)` — same guarantee for the destination.
- `CHECK (origin_seq < destination_seq)` — prevents a booking with a zero-length or backwards range, which the `EXCLUDE` constraint alone wouldn't catch (it only checks for overlap between ranges, not whether any individual range is well-formed).

**Why these together matter:** every one of these is a *declarative* constraint, not application logic or a trigger. The coach/seat FKs guarantee the seat's coach is really on this trip; the station/sequence FKs guarantee the display fields and the range-math fields can't drift apart, since both must come from the same `TripStop` row; the `CHECK` guarantees the range itself is sane; and the `EXCLUDE` constraint guarantees no two bookings' ranges overlap. A booking against a nonexistent stop, a mismatched station/sequence pair, an inverted range, or a coach that isn't attached to the trip is rejected by Postgres at insert time — the same way an overlapping segment is. Nothing here depends on the application remembering to check.

---

## How fare and occupancy are derived (recap)

Given a booking from station A to station B on `trip_id`:

1. Look up `TripStop` rows for A and B on that trip → get `(station_id, sequence, distance_km)` for each, as a single row per stop — not station and sequence looked up independently.
2. `origin_station_id`, `origin_seq` = A's `station_id`, `sequence` (from the *same* `TripStop` row) → stored on `Booking`, checked by the composite FK against `TripStop`. Same for `destination_station_id`, `destination_seq` from B.
3. Look up the seat's coach via `Seat.coach_id` → this becomes `Booking.coach_id`, and must be present in `TripCoach` for `trip_id` (enforced by the composite FK, not just checked in application code).
4. `leg_distance_km = B.distance_km - A.distance_km`
5. `rate_per_km` = looked up from `FareRule` via `coach_id → Coach.coach_type`
6. `fare = leg_distance_km * rate_per_km` → stored on `Booking`, not recomputed later.

---

## Entities not modeled (out of scope / assumed handled elsewhere)

- Payment processing — assumed to sit outside this schema, referenced only via `Booking.status`.
- Authentication for `Passenger` — assumed handled by an auth layer, not part of the data model itself.
