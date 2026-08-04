/* eslint-disable camelcase */

/**
 * Initial schema for the segment-based booking system.
 * Written as raw SQL (not generated from an ORM model) so the EXCLUDE USING
 * gist constraint — the core correctness guarantee of this system — is
 * exactly what's reviewed here, not something an abstraction layer produces.
 */

exports.up = (pgm) => {
  pgm.sql(`
    CREATE EXTENSION IF NOT EXISTS btree_gist;

    CREATE TABLE station (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      code TEXT
    );

    CREATE TABLE route (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL
    );

    CREATE TABLE route_station (
      id SERIAL PRIMARY KEY,
      route_id INT NOT NULL REFERENCES route(id),
      station_id INT NOT NULL REFERENCES station(id),
      sequence INT NOT NULL,
      distance_km NUMERIC NOT NULL,
      UNIQUE (route_id, station_id),
      UNIQUE (route_id, sequence)
    );

    CREATE TABLE train (
      id SERIAL PRIMARY KEY,
      train_name TEXT NOT NULL,
      train_number TEXT
    );

    CREATE TABLE trip (
      id SERIAL PRIMARY KEY,
      train_id INT NOT NULL REFERENCES train(id),
      route_id INT NOT NULL REFERENCES route(id),
      departure_time TIME NOT NULL,
      service_date DATE NOT NULL
    );

    CREATE TABLE trip_stop (
      id SERIAL PRIMARY KEY,
      trip_id INT NOT NULL REFERENCES trip(id),
      station_id INT NOT NULL REFERENCES station(id),
      sequence INT NOT NULL,
      distance_km NUMERIC NOT NULL,
      UNIQUE (trip_id, station_id),
      UNIQUE (trip_id, sequence),
      UNIQUE (trip_id, station_id, sequence)
    );

    CREATE TABLE coach (
      id SERIAL PRIMARY KEY,
      coach_number TEXT NOT NULL,
      coach_type TEXT NOT NULL CHECK (coach_type IN ('reserved','unreserved')),
      total_seats INT NOT NULL
    );

    CREATE TABLE seat (
      id SERIAL PRIMARY KEY,
      coach_id INT NOT NULL REFERENCES coach(id),
      seat_number TEXT NOT NULL,
      row INT,
      "column" INT,
      seat_type TEXT,
      UNIQUE (coach_id, id),
      UNIQUE (coach_id, seat_number)
    );

    CREATE TABLE trip_coach (
      id SERIAL PRIMARY KEY,
      trip_id INT NOT NULL REFERENCES trip(id),
      coach_id INT NOT NULL REFERENCES coach(id),
      position_in_train INT NOT NULL,
      UNIQUE (trip_id, coach_id)
    );

    CREATE TABLE fare_rule (
      id SERIAL PRIMARY KEY,
      coach_type TEXT NOT NULL CHECK (coach_type IN ('reserved','unreserved')),
      rate_per_km NUMERIC NOT NULL
    );

    CREATE TABLE passenger (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT
    );

    CREATE TABLE booking (
      id SERIAL PRIMARY KEY,
      trip_id INT NOT NULL REFERENCES trip(id),
      coach_id INT NOT NULL,
      seat_id INT NOT NULL,
      passenger_id INT NOT NULL REFERENCES passenger(id),
      origin_station_id INT NOT NULL,
      destination_station_id INT NOT NULL,
      origin_seq INT NOT NULL,
      destination_seq INT NOT NULL,
      fare NUMERIC NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('held','confirmed','cancelled')),
      held_until TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      FOREIGN KEY (coach_id, seat_id) REFERENCES seat(coach_id, id),
      FOREIGN KEY (trip_id, coach_id) REFERENCES trip_coach(trip_id, coach_id),
      FOREIGN KEY (trip_id, origin_station_id, origin_seq) REFERENCES trip_stop(trip_id, station_id, sequence),
      FOREIGN KEY (trip_id, destination_station_id, destination_seq) REFERENCES trip_stop(trip_id, station_id, sequence),
      CHECK (origin_seq < destination_seq),
      -- Core correctness guarantee: no two *active* bookings (held or confirmed)
      -- on the same seat, on the same trip, may have overlapping [origin_seq, destination_seq) ranges.
      -- Cancelled bookings are excluded via the WHERE predicate so they never block a new booking.
      EXCLUDE USING gist (
        seat_id WITH =,
        trip_id WITH =,
        int4range(origin_seq, destination_seq) WITH &&
      ) WHERE (status IN ('held', 'confirmed'))
    );

    CREATE INDEX idx_booking_trip_seat ON booking (trip_id, seat_id);
    CREATE INDEX idx_booking_held_until ON booking (held_until) WHERE status = 'held';
    CREATE INDEX idx_trip_service_date ON trip (route_id, service_date);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS booking CASCADE;
    DROP TABLE IF EXISTS passenger CASCADE;
    DROP TABLE IF EXISTS fare_rule CASCADE;
    DROP TABLE IF EXISTS trip_coach CASCADE;
    DROP TABLE IF EXISTS seat CASCADE;
    DROP TABLE IF EXISTS coach CASCADE;
    DROP TABLE IF EXISTS trip_stop CASCADE;
    DROP TABLE IF EXISTS trip CASCADE;
    DROP TABLE IF EXISTS train CASCADE;
    DROP TABLE IF EXISTS route_station CASCADE;
    DROP TABLE IF EXISTS route CASCADE;
    DROP TABLE IF EXISTS station CASCADE;
  `);
};
