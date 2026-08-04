/* eslint-disable camelcase */

/**
 * Additive migration: adds a schedule-offset template to route_station and
 * absolute scheduled times to trip_stop. Does not touch booking, the
 * EXCLUDE constraint, or anything the overlap check / fare calculation
 * depends on (sequence, distance_km) — all of that is unchanged.
 *
 * Dwell time: scheduled_arrival == scheduled_departure at every stop (no
 * dwell time modeled). See README for the reasoning.
 */

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE route_station
      ADD COLUMN offset_minutes INT NOT NULL DEFAULT 0;
    -- offset_minutes: minutes from the route's nominal start time. A
    -- *template* value used to seed trip_stop.scheduled_* at trip-creation
    -- time, the same way route_station.distance_km seeds trip_stop.distance_km.

    ALTER TABLE trip_stop
      ADD COLUMN scheduled_arrival TIMESTAMPTZ,
      ADD COLUMN scheduled_departure TIMESTAMPTZ;
    -- Nullable so this is a safe, non-breaking change against existing rows.
    -- Populated at trip-creation/seed time as:
    --   trip.service_date + trip.departure_time + route_station.offset_minutes

    -- Backfill offset_minutes for already-seeded route_station rows.
    -- Roughly proportional to distance (~1.4 min/km, plausible for this
    -- line's hill-country grades) -- monotonically increasing, not exact.
    UPDATE route_station
    SET offset_minutes = ROUND(distance_km * 1.4)::int;

    -- Backfill scheduled times for already-seeded trip_stop rows, using each
    -- trip's own service_date/departure_time and the trip_stop's own
    -- distance_km (already a per-trip snapshot, so this doesn't need to
    -- join back to route_station). Sri Lanka has a single UTC+5:30 offset
    -- year-round (no DST), so AT TIME ZONE 'Asia/Colombo' is unambiguous.
    UPDATE trip_stop ts
    SET scheduled_arrival = (
          (t.service_date + t.departure_time) AT TIME ZONE 'Asia/Colombo'
          + make_interval(mins => ROUND(ts.distance_km * 1.4)::int)
        ),
        scheduled_departure = (
          (t.service_date + t.departure_time) AT TIME ZONE 'Asia/Colombo'
          + make_interval(mins => ROUND(ts.distance_km * 1.4)::int)
        )
    FROM trip t
    WHERE ts.trip_id = t.id;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE trip_stop
      DROP COLUMN IF EXISTS scheduled_arrival,
      DROP COLUMN IF EXISTS scheduled_departure;
    ALTER TABLE route_station
      DROP COLUMN IF EXISTS offset_minutes;
  `);
};
