import type { Pool, PoolClient } from "pg";
import { pool, withTransaction } from "../db";
import { config } from "../config";
import { AppError, BadRequest, Conflict, NotFound, PG_EXCLUSION_VIOLATION, isPgError } from "../errors";

export interface CreateBookingInput {
  tripId: number;
  seatId: number;
  passengerId: number;
  originStationId: number;
  destinationStationId: number;
}

interface TripStopRow {
  station_id: number;
  sequence: number;
  distance_km: string;
  scheduled_arrival: string | null;
  scheduled_departure: string | null;
}

interface ScheduledTimes {
  originScheduledDeparture: string | null;
  destinationScheduledArrival: string | null;
}

const NO_SCHEDULED_TIMES: ScheduledTimes = { originScheduledDeparture: null, destinationScheduledArrival: null };

/** Every other endpoint in this API returns camelCase JSON; map booking rows
 * (raw `RETURNING *` / `SELECT *` results, which are snake_case Postgres
 * column names) to the same convention so the frontend has one consistent
 * contract to work against. */
function toBookingDto(row: Record<string, unknown>, scheduledTimes: ScheduledTimes = NO_SCHEDULED_TIMES) {
  return {
    id: row.id,
    tripId: row.trip_id,
    coachId: row.coach_id,
    seatId: row.seat_id,
    passengerId: row.passenger_id,
    originStationId: row.origin_station_id,
    destinationStationId: row.destination_station_id,
    originSeq: row.origin_seq,
    destinationSeq: row.destination_seq,
    fare: Number(row.fare),
    status: row.status,
    heldUntil: row.held_until,
    createdAt: row.created_at,
    // Looked up from trip_stop via the booking's existing FK
    // (trip_id, origin_station_id, origin_seq) / (..., destination_...),
    // never stored on booking itself — see README.
    originScheduledDeparture: scheduledTimes.originScheduledDeparture,
    destinationScheduledArrival: scheduledTimes.destinationScheduledArrival,
    ...(row.origin_station_name !== undefined && {
      originStationName: row.origin_station_name,
      destinationStationName: row.destination_station_name,
      passengerName: row.passenger_name,
      seatNumber: row.seat_number,
      coachNumber: row.coach_number,
      coachType: row.coach_type,
    }),
  };
}

interface BookingLegRow {
  trip_id: number;
  origin_station_id: number;
  origin_seq: number;
  destination_station_id: number;
  destination_seq: number;
}

/** Looks up a booking's leg's scheduled times from trip_stop. Kept as a
 * lookup (not a column on booking) so there's one source of truth — a trip's
 * schedule can only ever be read from trip_stop, never drift onto a stale
 * copy on the booking row. */
async function fetchScheduledTimes(queryable: PoolClient | Pool, leg: BookingLegRow): Promise<ScheduledTimes> {
  const { rows } = await queryable.query(
    `SELECT
       (SELECT scheduled_departure FROM trip_stop WHERE trip_id = $1 AND station_id = $2 AND sequence = $3) AS origin_scheduled_departure,
       (SELECT scheduled_arrival FROM trip_stop WHERE trip_id = $1 AND station_id = $4 AND sequence = $5) AS destination_scheduled_arrival`,
    [leg.trip_id, leg.origin_station_id, leg.origin_seq, leg.destination_station_id, leg.destination_seq]
  );
  return {
    originScheduledDeparture: rows[0]?.origin_scheduled_departure ?? null,
    destinationScheduledArrival: rows[0]?.destination_scheduled_arrival ?? null,
  };
}

/**
 * Creates a 'held' booking for one seat/leg inside a single transaction:
 * resolve the trip_stop rows for origin/destination, verify the seat's
 * coach is attached to the trip, compute the fare, sweep this seat's
 * expired holds (so a stale 'held' row never falsely blocks this attempt
 * even if the background sweeper hasn't run yet), then insert.
 *
 * A losing concurrent insert surfaces as Postgres error 23P01 (EXCLUDE
 * constraint violation) and is translated into a 409 here — never leaked
 * to the client as a raw database error.
 */
export async function createHeldBooking(input: CreateBookingInput) {
  return withTransaction(async (client) => {
    const stopRows = await client.query<TripStopRow>(
      `SELECT station_id, sequence, distance_km, scheduled_arrival, scheduled_departure
       FROM trip_stop
       WHERE trip_id = $1 AND station_id = ANY($2::int[])`,
      [input.tripId, [input.originStationId, input.destinationStationId]]
    );

    const origin = stopRows.rows.find((r) => r.station_id === input.originStationId);
    const destination = stopRows.rows.find((r) => r.station_id === input.destinationStationId);

    if (!origin || !destination) {
      throw BadRequest("origin/destination station is not a stop on this trip");
    }
    if (origin.sequence >= destination.sequence) {
      throw BadRequest("destination must come after origin on this trip");
    }

    const seatRows = await client.query(
      `SELECT seat.coach_id, coach.coach_type
       FROM seat
       JOIN coach ON coach.id = seat.coach_id
       WHERE seat.id = $1`,
      [input.seatId]
    );
    const seat = seatRows.rows[0];
    if (!seat) throw NotFound(`Seat ${input.seatId} not found`);
    if (seat.coach_type !== "reserved") {
      throw BadRequest("Only seats in reserved coaches can be booked individually");
    }

    const tripCoachRows = await client.query(
      `SELECT 1 FROM trip_coach WHERE trip_id = $1 AND coach_id = $2`,
      [input.tripId, seat.coach_id]
    );
    if (tripCoachRows.rowCount === 0) {
      throw BadRequest("This seat's coach is not attached to this trip");
    }

    const fareRuleRows = await client.query(
      `SELECT rate_per_km FROM fare_rule WHERE coach_type = $1 LIMIT 1`,
      [seat.coach_type]
    );
    const fareRule = fareRuleRows.rows[0];
    if (!fareRule) throw new AppError(500, `No fare_rule configured for coach_type '${seat.coach_type}'`);

    const legDistanceKm = Number(destination.distance_km) - Number(origin.distance_km);
    const fare = legDistanceKm * Number(fareRule.rate_per_km);

    // Lazy sweep, scoped to this seat/trip: an expired hold on the exact
    // seat being requested must not survive to block this insert, even if
    // the background sweeper hasn't ticked yet.
    await client.query(
      `UPDATE booking
       SET status = 'cancelled'
       WHERE status = 'held' AND held_until < now()
         AND trip_id = $1 AND seat_id = $2`,
      [input.tripId, input.seatId]
    );

    const heldUntil = new Date(Date.now() + config.holdDurationMinutes * 60 * 1000);

    try {
      const { rows } = await client.query(
        `INSERT INTO booking (
           trip_id, coach_id, seat_id, passenger_id,
           origin_station_id, destination_station_id, origin_seq, destination_seq,
           fare, status, held_until
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'held', $10)
         RETURNING *`,
        [
          input.tripId,
          seat.coach_id,
          input.seatId,
          input.passengerId,
          input.originStationId,
          input.destinationStationId,
          origin.sequence,
          destination.sequence,
          fare,
          heldUntil,
        ]
      );
      return toBookingDto(rows[0], {
        originScheduledDeparture: origin.scheduled_departure,
        destinationScheduledArrival: destination.scheduled_arrival,
      });
    } catch (err) {
      if (isPgError(err) && err.code === PG_EXCLUSION_VIOLATION) {
        throw Conflict(
          `Seat ${input.seatId} is no longer available for this leg — it overlaps an existing held or confirmed booking on this trip.`
        );
      }
      throw err;
    }
  });
}

export async function confirmBooking(bookingId: number) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE booking
       SET status = 'confirmed'
       WHERE id = $1 AND status = 'held' AND held_until > now()
       RETURNING *`,
      [bookingId]
    );

    if (rows[0]) return toBookingDto(rows[0], await fetchScheduledTimes(client, rows[0]));

    const existing = await getBookingWithClient(client, bookingId);
    if (!existing) throw NotFound(`Booking ${bookingId} not found`);
    if (existing.status === "confirmed") return toBookingDto(existing, await fetchScheduledTimes(client, existing));
    if (existing.status === "held") {
      throw Conflict(`Booking ${bookingId}'s hold has expired — the seat must be re-booked`);
    }
    throw Conflict(`Booking ${bookingId} can no longer be confirmed (status: ${existing.status})`);
  });
}

export async function cancelBooking(bookingId: number) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE booking
       SET status = 'cancelled'
       WHERE id = $1 AND status IN ('held', 'confirmed')
       RETURNING *`,
      [bookingId]
    );

    if (rows[0]) return toBookingDto(rows[0], await fetchScheduledTimes(client, rows[0]));

    const existing = await getBookingWithClient(client, bookingId);
    if (!existing) throw NotFound(`Booking ${bookingId} not found`);
    throw Conflict(`Booking ${bookingId} is already cancelled`);
  });
}

async function getBookingWithClient(client: PoolClient, bookingId: number) {
  const { rows } = await client.query(`SELECT * FROM booking WHERE id = $1`, [bookingId]);
  return rows[0] ?? null;
}

export async function getBookingDetail(bookingId: number) {
  const { rows } = await pool.query(
    `SELECT b.*, os.name AS origin_station_name, ds.name AS destination_station_name,
            p.name AS passenger_name, s.seat_number, c.coach_number, c.coach_type,
            ots.scheduled_departure AS origin_scheduled_departure,
            dts.scheduled_arrival AS destination_scheduled_arrival
     FROM booking b
     JOIN station os ON os.id = b.origin_station_id
     JOIN station ds ON ds.id = b.destination_station_id
     JOIN passenger p ON p.id = b.passenger_id
     JOIN seat s ON s.id = b.seat_id
     JOIN coach c ON c.id = b.coach_id
     JOIN trip_stop ots ON ots.trip_id = b.trip_id AND ots.station_id = b.origin_station_id AND ots.sequence = b.origin_seq
     JOIN trip_stop dts ON dts.trip_id = b.trip_id AND dts.station_id = b.destination_station_id AND dts.sequence = b.destination_seq
     WHERE b.id = $1`,
    [bookingId]
  );
  const row = rows[0];
  if (!row) return null;
  return toBookingDto(row, {
    originScheduledDeparture: row.origin_scheduled_departure,
    destinationScheduledArrival: row.destination_scheduled_arrival,
  });
}
