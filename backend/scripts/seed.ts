import "dotenv/config";
import { Pool, type PoolClient } from "pg";

/**
 * Seed configuration. These numbers are data, not application logic — the
 * backend and frontend never assume "3 reserved coaches", "20 stations", or
 * "one trip" anywhere; they read whatever ended up in the database. Change
 * these constants (or write a different seed entirely) to model a longer
 * route, more coaches, or a different schedule without touching any API or
 * frontend code.
 */
const STATIONS: { name: string; code: string; distanceKm: number }[] = [
  { name: "Colombo Fort", code: "CMB", distanceKm: 0 },
  { name: "Ragama", code: "RGM", distanceKm: 15 },
  { name: "Gampaha", code: "GMP", distanceKm: 30 },
  { name: "Veyangoda", code: "VYG", distanceKm: 42 },
  { name: "Polgahawela", code: "PLW", distanceKm: 55 },
  { name: "Rambukkana", code: "RBK", distanceKm: 66 },
  { name: "Kadugannawa", code: "KDG", distanceKm: 92 },
  { name: "Peradeniya", code: "PRD", distanceKm: 108 },
  { name: "Kandy", code: "KDY", distanceKm: 121 },
  { name: "Gampola", code: "GPL", distanceKm: 135 },
  { name: "Nawalapitiya", code: "NWP", distanceKm: 149 },
  { name: "Hatton", code: "HTN", distanceKm: 172 },
  { name: "Talawakele", code: "TLW", distanceKm: 184 },
  { name: "Nanu Oya", code: "NNO", distanceKm: 194 },
  { name: "Pattipola", code: "PTP", distanceKm: 227 },
  { name: "Haputale", code: "HPT", distanceKm: 246 },
  { name: "Bandarawela", code: "BDW", distanceKm: 259 },
  { name: "Ella", code: "ELL", distanceKm: 267 },
  { name: "Demodara", code: "DMD", distanceKm: 278 },
  { name: "Badulla", code: "BDL", distanceKm: 292 },
];

const ROUTE_NAME = "Colombo Fort–Badulla";

// Minutes of scheduled running time per km — plausible for this line's
// hill-country grades, not precise. Matches the rate used by the
// 1706000100000_add_scheduled_times migration's backfill of pre-existing
// rows, so a full re-seed and that backfill produce materially the same
// schedule.
const SCHEDULE_MINUTES_PER_KM = 1.4;

const RESERVED_COACH_COUNT = 3;
const UNRESERVED_COACH_COUNT = 5;
const SEATS_PER_RESERVED_COACH = 44; // 11 rows x 4 seats (A/B aisle C/D)
const UNRESERVED_COACH_SEAT_CAPACITY = 90; // no per-seat rows; capacity only

const FARE_RULES = [
  { coachType: "reserved", ratePerKm: 4.5 },
  { coachType: "unreserved", ratePerKm: 2.2 },
];

type Direction = "southbound" | "northbound";

// Real named trains that run this line in both directions — southbound
// (Colombo Fort -> Badulla) and northbound (Badulla -> Colombo Fort) are
// genuinely separate trips (different train_number, like real up/down
// services), each scheduled across the next few days.
const TRIP_SPECS: {
  trainName: string;
  trainNumber: string;
  departureTime: string;
  dayOffset: number;
  direction: Direction;
}[] = [0, 1, 2].flatMap((dayOffset) => [
  { trainName: "Podi Menike", trainNumber: "1005", departureTime: "05:55:00", dayOffset, direction: "southbound" },
  { trainName: "Udarata Menike", trainNumber: "1015", departureTime: "08:35:00", dayOffset, direction: "southbound" },
  { trainName: "Podi Menike", trainNumber: "1006", departureTime: "08:30:00", dayOffset, direction: "northbound" },
  { trainName: "Udarata Menike", trainNumber: "1016", departureTime: "05:20:00", dayOffset, direction: "northbound" },
]);

function seatLayout(index: number): { seatNumber: string; row: number; column: number; seatType: string } {
  const seatsPerRow = 4;
  const row = Math.floor(index / seatsPerRow) + 1;
  const columnIndex = index % seatsPerRow; // 0..3
  const letters = ["A", "B", "C", "D"];
  const seatType = columnIndex === 0 || columnIndex === 3 ? "window" : "aisle";
  return { seatNumber: `${row}${letters[columnIndex]}`, row, column: columnIndex + 1, seatType };
}

function dateStringWithOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// Sri Lanka is UTC+5:30 year-round (no DST), so this is unambiguous without
// depending on the machine's local timezone. serviceDate is 'YYYY-MM-DD',
// departureTime is 'HH:MM:SS', both representing Colombo wall-clock time.
function scheduledTimeAt(serviceDate: string, departureTime: string, offsetMinutes: number): Date {
  const [year, month, day] = serviceDate.split("-").map(Number);
  const [hour, minute, second] = departureTime.split(":").map(Number);
  const SRI_LANKA_UTC_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const utcMillis =
    Date.UTC(year, month - 1, day, hour, minute, second ?? 0) - SRI_LANKA_UTC_OFFSET_MS + offsetMinutes * 60 * 1000;
  return new Date(utcMillis);
}

interface StationRow {
  id: number;
  name: string;
  sequence: number;
  distanceKm: number;
  offsetMinutes: number;
}

interface StopSpec {
  id: number;
  sequence: number;
  distanceKm: number;
  offsetMinutes: number;
}

/**
 * Builds the ordered stop list for one direction of travel. Southbound
 * reuses route_station's own sequence/distance/offset directly (Colombo
 * Fort = 0km). Northbound re-bases everything from the *other* end
 * (Badulla = 0km) and renumbers sequence 1..N along the reversed path —
 * trip_stop is deliberately "seeded from route_station but not permanently
 * bound to it" (schema-v1.md) specifically so a trip can travel a route
 * backwards like this without any schema change.
 */
function buildStops(stations: StationRow[], direction: Direction): StopSpec[] {
  if (direction === "southbound") {
    return stations.map((s) => ({
      id: s.id,
      sequence: s.sequence,
      distanceKm: s.distanceKm,
      offsetMinutes: s.offsetMinutes,
    }));
  }

  const totalDistanceKm = stations[stations.length - 1].distanceKm;
  return [...stations].reverse().map((s, index) => {
    const distanceKm = totalDistanceKm - s.distanceKm;
    return {
      id: s.id,
      sequence: index + 1,
      distanceKm,
      offsetMinutes: Math.round(distanceKm * SCHEDULE_MINUTES_PER_KM),
    };
  });
}

async function getOrCreateRoute(client: PoolClient): Promise<{ routeId: number; isNew: boolean }> {
  const existing = await client.query("SELECT id FROM route WHERE name = $1", [ROUTE_NAME]);
  if (existing.rowCount && existing.rowCount > 0) {
    return { routeId: existing.rows[0].id, isNew: false };
  }
  const { rows } = await client.query("INSERT INTO route (name) VALUES ($1) RETURNING id", [ROUTE_NAME]);
  return { routeId: rows[0].id, isNew: true };
}

async function getOrCreateStations(client: PoolClient, routeId: number, routeIsNew: boolean): Promise<StationRow[]> {
  if (!routeIsNew) {
    const { rows } = await client.query(
      `SELECT s.id, s.name, rs.sequence, rs.distance_km, rs.offset_minutes
       FROM route_station rs
       JOIN station s ON s.id = rs.station_id
       WHERE rs.route_id = $1
       ORDER BY rs.sequence ASC`,
      [routeId]
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      sequence: r.sequence,
      distanceKm: Number(r.distance_km),
      offsetMinutes: r.offset_minutes,
    }));
  }

  const result: StationRow[] = [];
  for (let i = 0; i < STATIONS.length; i++) {
    const s = STATIONS[i];
    const offsetMinutes = Math.round(s.distanceKm * SCHEDULE_MINUTES_PER_KM);
    const { rows } = await client.query(
      "INSERT INTO station (name, code) VALUES ($1, $2) RETURNING id",
      [s.name, s.code]
    );
    const stationId: number = rows[0].id;
    await client.query(
      `INSERT INTO route_station (route_id, station_id, sequence, distance_km, offset_minutes) VALUES ($1, $2, $3, $4, $5)`,
      [routeId, stationId, i + 1, s.distanceKm, offsetMinutes]
    );
    result.push({ id: stationId, name: s.name, sequence: i + 1, distanceKm: s.distanceKm, offsetMinutes });
  }
  return result;
}

async function getOrCreateTrain(client: PoolClient, name: string, number: string): Promise<number> {
  const existing = await client.query("SELECT id FROM train WHERE train_name = $1 AND train_number = $2", [
    name,
    number,
  ]);
  if (existing.rowCount && existing.rowCount > 0) return existing.rows[0].id;

  const { rows } = await client.query(
    "INSERT INTO train (train_name, train_number) VALUES ($1, $2) RETURNING id",
    [name, number]
  );
  return rows[0].id;
}

async function getOrCreateCoaches(client: PoolClient): Promise<number[]> {
  const coachIds: number[] = [];

  for (let i = 1; i <= RESERVED_COACH_COUNT; i++) {
    const coachNumber = `RC-${i}`;
    const existing = await client.query("SELECT id FROM coach WHERE coach_number = $1", [coachNumber]);
    if (existing.rowCount && existing.rowCount > 0) {
      coachIds.push(existing.rows[0].id);
      continue;
    }

    const { rows } = await client.query(
      `INSERT INTO coach (coach_number, coach_type, total_seats) VALUES ($1, 'reserved', $2) RETURNING id`,
      [coachNumber, SEATS_PER_RESERVED_COACH]
    );
    const coachId: number = rows[0].id;

    for (let seatIndex = 0; seatIndex < SEATS_PER_RESERVED_COACH; seatIndex++) {
      const layout = seatLayout(seatIndex);
      await client.query(
        `INSERT INTO seat (coach_id, seat_number, row, "column", seat_type) VALUES ($1, $2, $3, $4, $5)`,
        [coachId, layout.seatNumber, layout.row, layout.column, layout.seatType]
      );
    }
    coachIds.push(coachId);
  }

  for (let i = 1; i <= UNRESERVED_COACH_COUNT; i++) {
    const coachNumber = `UC-${i}`;
    const existing = await client.query("SELECT id FROM coach WHERE coach_number = $1", [coachNumber]);
    if (existing.rowCount && existing.rowCount > 0) {
      coachIds.push(existing.rows[0].id);
      continue;
    }

    // Unreserved coaches are first-come-first-served with no seat
    // assignment (see README) — intentionally no `seat` rows are created
    // for them.
    const { rows } = await client.query(
      `INSERT INTO coach (coach_number, coach_type, total_seats) VALUES ($1, 'unreserved', $2) RETURNING id`,
      [coachNumber, UNRESERVED_COACH_SEAT_CAPACITY]
    );
    coachIds.push(rows[0].id);
  }

  return coachIds;
}

async function getOrCreateFareRules(client: PoolClient): Promise<void> {
  for (const rule of FARE_RULES) {
    const existing = await client.query("SELECT id FROM fare_rule WHERE coach_type = $1", [rule.coachType]);
    if (existing.rowCount && existing.rowCount > 0) continue;
    await client.query(`INSERT INTO fare_rule (coach_type, rate_per_km) VALUES ($1, $2)`, [
      rule.coachType,
      rule.ratePerKm,
    ]);
  }
}

async function ensureTrip(
  client: PoolClient,
  trainId: number,
  routeId: number,
  departureTime: string,
  serviceDate: string,
  stops: StopSpec[],
  coachIds: number[]
): Promise<{ tripId: number; created: boolean }> {
  const existing = await client.query(
    `SELECT id FROM trip WHERE train_id = $1 AND route_id = $2 AND departure_time = $3 AND service_date = $4`,
    [trainId, routeId, departureTime, serviceDate]
  );
  if (existing.rowCount && existing.rowCount > 0) {
    return { tripId: existing.rows[0].id, created: false };
  }

  const { rows } = await client.query(
    `INSERT INTO trip (train_id, route_id, departure_time, service_date) VALUES ($1, $2, $3, $4) RETURNING id`,
    [trainId, routeId, departureTime, serviceDate]
  );
  const tripId: number = rows[0].id;

  for (const s of stops) {
    // No dwell time modeled: scheduled_arrival == scheduled_departure at
    // every stop (see README).
    const scheduledTime = scheduledTimeAt(serviceDate, departureTime, s.offsetMinutes);
    await client.query(
      `INSERT INTO trip_stop (trip_id, station_id, sequence, distance_km, scheduled_arrival, scheduled_departure)
       VALUES ($1, $2, $3, $4, $5, $5)`,
      [tripId, s.id, s.sequence, s.distanceKm, scheduledTime]
    );
  }

  for (let i = 0; i < coachIds.length; i++) {
    await client.query(
      `INSERT INTO trip_coach (trip_id, coach_id, position_in_train) VALUES ($1, $2, $3)`,
      [tripId, coachIds[i], i + 1]
    );
  }

  return { tripId, created: true };
}

async function seed(client: PoolClient) {
  await client.query("BEGIN");

  const { routeId, isNew: routeIsNew } = await getOrCreateRoute(client);
  const stations = await getOrCreateStations(client, routeId, routeIsNew);
  const coachIds = await getOrCreateCoaches(client);
  await getOrCreateFareRules(client);

  const trainIdByKey = new Map<string, number>();
  let createdCount = 0;
  let skippedCount = 0;
  for (const spec of TRIP_SPECS) {
    const key = `${spec.trainName}|${spec.trainNumber}`;
    let trainId = trainIdByKey.get(key);
    if (trainId === undefined) {
      trainId = await getOrCreateTrain(client, spec.trainName, spec.trainNumber);
      trainIdByKey.set(key, trainId);
    }
    const serviceDate = dateStringWithOffset(spec.dayOffset);
    const stops = buildStops(stations, spec.direction);
    const { created } = await ensureTrip(client, trainId, routeId, spec.departureTime, serviceDate, stops, coachIds);
    if (created) createdCount++;
    else skippedCount++;
  }

  await client.query("COMMIT");

  console.log(
    `Route "${ROUTE_NAME}" (id ${routeId}), ${stations.length} stations, ${coachIds.length} coaches. ` +
      `Trips: ${createdCount} created, ${skippedCount} already existed.`
  );
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Copy backend/.env.example to backend/.env first.");
  }

  const pool = new Pool({ connectionString });
  const client = await pool.connect();
  try {
    await seed(client);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
