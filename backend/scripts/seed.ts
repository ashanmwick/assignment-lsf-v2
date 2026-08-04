import "dotenv/config";
import { Pool, type PoolClient } from "pg";

/**
 * Seed configuration. These numbers are data, not application logic — the
 * backend and frontend never assume "3 reserved coaches" or "20 stations"
 * anywhere; they read whatever ended up in the database. Change these
 * constants (or write a different seed entirely) to model a longer route,
 * more coaches, or a different seat layout without touching any API code.
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
const TRAIN_NAME = "Podi Menike";
const TRAIN_NUMBER = "1005";
const DEPARTURE_TIME = "05:55:00";

const RESERVED_COACH_COUNT = 3;
const UNRESERVED_COACH_COUNT = 5;
const SEATS_PER_RESERVED_COACH = 44; // 11 rows x 4 seats (A/B aisle C/D)
const UNRESERVED_COACH_SEAT_CAPACITY = 90; // no per-seat rows; capacity only

const FARE_RULES = [
  { coachType: "reserved", ratePerKm: 4.5 },
  { coachType: "unreserved", ratePerKm: 2.2 },
];

function seatLayout(index: number): { seatNumber: string; row: number; column: number; seatType: string } {
  const seatsPerRow = 4;
  const row = Math.floor(index / seatsPerRow) + 1;
  const columnIndex = index % seatsPerRow; // 0..3
  const letters = ["A", "B", "C", "D"];
  const seatType = columnIndex === 0 || columnIndex === 3 ? "window" : "aisle";
  return { seatNumber: `${row}${letters[columnIndex]}`, row, column: columnIndex + 1, seatType };
}

function todayAsDateString(): string {
  const now = new Date();
  return now.toISOString().slice(0, 10);
}

async function seed(client: PoolClient) {
  const existingRoute = await client.query("SELECT id FROM route WHERE name = $1", [ROUTE_NAME]);
  if (existingRoute.rowCount && existingRoute.rowCount > 0) {
    console.log(`Route "${ROUTE_NAME}" already exists (id ${existingRoute.rows[0].id}) — skipping seed.`);
    return;
  }

  await client.query("BEGIN");

  // Stations
  const stationIds: number[] = [];
  for (const s of STATIONS) {
    const { rows } = await client.query(
      "INSERT INTO station (name, code) VALUES ($1, $2) RETURNING id",
      [s.name, s.code]
    );
    stationIds.push(rows[0].id);
  }

  // Route + RouteStation
  const { rows: routeRows } = await client.query(
    "INSERT INTO route (name) VALUES ($1) RETURNING id",
    [ROUTE_NAME]
  );
  const routeId: number = routeRows[0].id;

  for (let i = 0; i < STATIONS.length; i++) {
    await client.query(
      `INSERT INTO route_station (route_id, station_id, sequence, distance_km)
       VALUES ($1, $2, $3, $4)`,
      [routeId, stationIds[i], i + 1, STATIONS[i].distanceKm]
    );
  }

  // Train
  const { rows: trainRows } = await client.query(
    "INSERT INTO train (train_name, train_number) VALUES ($1, $2) RETURNING id",
    [TRAIN_NAME, TRAIN_NUMBER]
  );
  const trainId: number = trainRows[0].id;

  // Trip
  const { rows: tripRows } = await client.query(
    `INSERT INTO trip (train_id, route_id, departure_time, service_date)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [trainId, routeId, DEPARTURE_TIME, todayAsDateString()]
  );
  const tripId: number = tripRows[0].id;

  // TripStop, seeded from RouteStation
  for (let i = 0; i < STATIONS.length; i++) {
    await client.query(
      `INSERT INTO trip_stop (trip_id, station_id, sequence, distance_km)
       VALUES ($1, $2, $3, $4)`,
      [tripId, stationIds[i], i + 1, STATIONS[i].distanceKm]
    );
  }

  // Coaches + TripCoach
  let position = 1;
  for (let i = 1; i <= RESERVED_COACH_COUNT; i++) {
    const { rows: coachRows } = await client.query(
      `INSERT INTO coach (coach_number, coach_type, total_seats)
       VALUES ($1, 'reserved', $2) RETURNING id`,
      [`RC-${i}`, SEATS_PER_RESERVED_COACH]
    );
    const coachId: number = coachRows[0].id;

    for (let seatIndex = 0; seatIndex < SEATS_PER_RESERVED_COACH; seatIndex++) {
      const layout = seatLayout(seatIndex);
      await client.query(
        `INSERT INTO seat (coach_id, seat_number, row, "column", seat_type)
         VALUES ($1, $2, $3, $4, $5)`,
        [coachId, layout.seatNumber, layout.row, layout.column, layout.seatType]
      );
    }

    await client.query(
      `INSERT INTO trip_coach (trip_id, coach_id, position_in_train) VALUES ($1, $2, $3)`,
      [tripId, coachId, position++]
    );
  }

  for (let i = 1; i <= UNRESERVED_COACH_COUNT; i++) {
    const { rows: coachRows } = await client.query(
      `INSERT INTO coach (coach_number, coach_type, total_seats)
       VALUES ($1, 'unreserved', $2) RETURNING id`,
      [`UC-${i}`, UNRESERVED_COACH_SEAT_CAPACITY]
    );
    const coachId: number = coachRows[0].id;

    // Unreserved coaches are first-come-first-served with no seat
    // assignment (see README) — intentionally no `seat` rows are created
    // for them, only the trip_coach attachment.
    await client.query(
      `INSERT INTO trip_coach (trip_id, coach_id, position_in_train) VALUES ($1, $2, $3)`,
      [tripId, coachId, position++]
    );
  }

  // FareRule
  for (const rule of FARE_RULES) {
    await client.query(
      `INSERT INTO fare_rule (coach_type, rate_per_km) VALUES ($1, $2)`,
      [rule.coachType, rule.ratePerKm]
    );
  }

  await client.query("COMMIT");

  console.log(`Seeded route "${ROUTE_NAME}" (id ${routeId}), trip id ${tripId}, ${STATIONS.length} stations, ` +
    `${RESERVED_COACH_COUNT} reserved + ${UNRESERVED_COACH_COUNT} unreserved coaches.`);
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
