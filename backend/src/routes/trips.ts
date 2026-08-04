import { Router } from "express";
import { pool } from "../db";
import { BadRequest, NotFound } from "../errors";

export const tripsRouter = Router();

// GET /api/trips?routeId=&date=&origin=&destination= — list trips, optionally
// filtered. When origin and destination (station ids) are both given, only
// trips that actually stop at both — in that order — are returned, and each
// result is enriched with that leg's scheduled departure/arrival (looked up
// from trip_stop, not stored anywhere new). This is deliberately a
// stop-level check against trip_stop, not just "same route": a trip's stops
// are seeded from route_station but aren't permanently bound to it
// (schema-v1.md), so a trip could in principle skip a stop.
tripsRouter.get("/trips", async (req, res, next) => {
  try {
    const { routeId, date, origin, destination } = req.query;
    const conditions: string[] = [];
    const params: unknown[] = [];
    let legJoin = "";
    let legSelect = "";

    if (routeId !== undefined) {
      params.push(Number(routeId));
      conditions.push(`trip.route_id = $${params.length}`);
    }
    if (date !== undefined) {
      params.push(String(date));
      conditions.push(`trip.service_date = $${params.length}`);
    }

    if (origin !== undefined || destination !== undefined) {
      const originId = Number(origin);
      const destinationId = Number(destination);
      if (!Number.isInteger(originId) || !Number.isInteger(destinationId)) {
        throw BadRequest("origin and destination must both be provided together as station ids");
      }
      params.push(originId, destinationId);
      const originParam = params.length - 1;
      const destinationParam = params.length;
      // An inner join, not just an EXISTS check, so the leg's scheduled
      // times can be selected directly alongside each trip.
      legJoin = `
        JOIN trip_stop os ON os.trip_id = trip.id AND os.station_id = $${originParam}
        JOIN trip_stop ds ON ds.trip_id = trip.id AND ds.station_id = $${destinationParam} AND ds.sequence > os.sequence
      `;
      legSelect = `, os.scheduled_departure AS origin_scheduled_departure, ds.scheduled_arrival AS destination_scheduled_arrival`;
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const { rows } = await pool.query(
      `SELECT trip.id, trip.route_id, trip.train_id, trip.departure_time, trip.service_date,
              route.name AS route_name, train.train_name, train.train_number
              ${legSelect}
       FROM trip
       JOIN route ON route.id = trip.route_id
       JOIN train ON train.id = trip.train_id
       ${legJoin}
       ${where}
       ORDER BY trip.service_date ASC, trip.departure_time ASC`,
      params
    );

    res.json(
      rows.map((r) => ({
        id: r.id,
        routeId: r.route_id,
        routeName: r.route_name,
        trainId: r.train_id,
        trainName: r.train_name,
        trainNumber: r.train_number,
        departureTime: r.departure_time,
        serviceDate: r.service_date,
        originScheduledDeparture: r.origin_scheduled_departure ?? null,
        destinationScheduledArrival: r.destination_scheduled_arrival ?? null,
      }))
    );
  } catch (err) {
    next(err);
  }
});

// GET /api/trips/:tripId — trip detail (route id etc. so the frontend can
// fetch the station list for the trip's route).
tripsRouter.get("/trips/:tripId", async (req, res, next) => {
  try {
    const tripId = Number(req.params.tripId);
    if (!Number.isInteger(tripId)) throw BadRequest("tripId must be an integer");

    const { rows } = await pool.query(
      `SELECT trip.id, trip.route_id, trip.train_id, trip.departure_time, trip.service_date,
              route.name AS route_name, train.train_name, train.train_number
       FROM trip
       JOIN route ON route.id = trip.route_id
       JOIN train ON train.id = trip.train_id
       WHERE trip.id = $1`,
      [tripId]
    );

    const trip = rows[0];
    if (!trip) throw NotFound(`Trip ${tripId} not found`);

    res.json({
      id: trip.id,
      routeId: trip.route_id,
      routeName: trip.route_name,
      trainId: trip.train_id,
      trainName: trip.train_name,
      trainNumber: trip.train_number,
      departureTime: trip.departure_time,
      serviceDate: trip.service_date,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/trips/:tripId/availability?origin=stationId&destination=stationId
 *
 * For the requested leg, returns every seat in every coach attached to the
 * trip, with an availability status for that specific leg. A seat is
 * 'available' iff no active (held/confirmed) booking on that seat/trip has
 * an overlapping [origin_seq, destination_seq) range with the requested leg.
 * Unreserved coaches are returned with no per-seat data (first-come,
 * first-served — see README for why seat-level booking is out of scope
 * for them).
 */
tripsRouter.get("/trips/:tripId/availability", async (req, res, next) => {
  try {
    const tripId = Number(req.params.tripId);
    const originStationId = Number(req.query.origin);
    const destinationStationId = Number(req.query.destination);

    if (!Number.isInteger(tripId)) throw BadRequest("tripId must be an integer");
    if (!Number.isInteger(originStationId) || !Number.isInteger(destinationStationId)) {
      throw BadRequest("origin and destination query params must be station ids");
    }

    const stopRows = await pool.query(
      `SELECT station_id, sequence, distance_km, scheduled_arrival, scheduled_departure
       FROM trip_stop
       WHERE trip_id = $1 AND station_id = ANY($2::int[])`,
      [tripId, [originStationId, destinationStationId]]
    );

    const origin = stopRows.rows.find((r) => r.station_id === originStationId);
    const destination = stopRows.rows.find((r) => r.station_id === destinationStationId);

    if (!origin || !destination) {
      throw BadRequest("origin/destination station is not a stop on this trip");
    }
    if (origin.sequence >= destination.sequence) {
      throw BadRequest("destination must come after origin on this trip");
    }

    const { rows: coachRows } = await pool.query(
      `SELECT coach.id AS coach_id, coach.coach_number, coach.coach_type,
              coach.total_seats, trip_coach.position_in_train
       FROM trip_coach
       JOIN coach ON coach.id = trip_coach.coach_id
       WHERE trip_coach.trip_id = $1
       ORDER BY trip_coach.position_in_train ASC`,
      [tripId]
    );

    const { rows: seatRows } = await pool.query(
      `SELECT seat.id AS seat_id, seat.coach_id, seat.seat_number, seat.row,
              seat."column", seat.seat_type,
              bk.status AS booking_status
       FROM seat
       JOIN coach ON coach.id = seat.coach_id
       JOIN trip_coach ON trip_coach.coach_id = coach.id AND trip_coach.trip_id = $1
       LEFT JOIN LATERAL (
         SELECT status
         FROM booking
         WHERE booking.seat_id = seat.id
           AND booking.trip_id = $1
           AND booking.status IN ('held', 'confirmed')
           AND int4range(booking.origin_seq, booking.destination_seq) && int4range($2::int, $3::int)
         LIMIT 1
       ) bk ON true
       WHERE coach.coach_type = 'reserved'
       ORDER BY seat.coach_id ASC, seat.row ASC NULLS LAST, seat.id ASC`,
      [tripId, origin.sequence, destination.sequence]
    );

    const seatsByCoach = new Map<number, unknown[]>();
    for (const s of seatRows) {
      const list = seatsByCoach.get(s.coach_id) ?? [];
      list.push({
        seatId: s.seat_id,
        seatNumber: s.seat_number,
        row: s.row,
        column: s.column,
        seatType: s.seat_type,
        status: s.booking_status ?? "available",
      });
      seatsByCoach.set(s.coach_id, list);
    }

    const coaches = coachRows.map((c) => ({
      coachId: c.coach_id,
      coachNumber: c.coach_number,
      coachType: c.coach_type,
      totalSeats: c.total_seats,
      positionInTrain: c.position_in_train,
      seats: c.coach_type === "reserved" ? seatsByCoach.get(c.coach_id) ?? [] : [],
    }));

    res.json({
      tripId,
      origin: {
        stationId: originStationId,
        sequence: origin.sequence,
        distanceKm: Number(origin.distance_km),
        scheduledDeparture: origin.scheduled_departure,
      },
      destination: {
        stationId: destinationStationId,
        sequence: destination.sequence,
        distanceKm: Number(destination.distance_km),
        scheduledArrival: destination.scheduled_arrival,
      },
      coaches,
    });
  } catch (err) {
    next(err);
  }
});
