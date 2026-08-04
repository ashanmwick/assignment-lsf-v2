#!/usr/bin/env node
/**
 * Proves the core correctness guarantee of the booking system: fire two
 * concurrent POST /api/bookings requests for the *same seat* on the *same
 * trip* with fully overlapping legs, and assert exactly one succeeds (201)
 * while the other is rejected with a 409 — driven entirely by the booking
 * table's EXCLUDE USING gist constraint, not application-level locking.
 *
 * Requires the backend running (npm run dev in backend/) against a seeded
 * database (npm run seed in backend/). Talks to the API only — no direct DB
 * access — so it's a true black-box integration test.
 *
 * Usage: node scripts/concurrency-test.mjs
 * Override the backend URL with: API_BASE_URL=http://localhost:4000 node scripts/concurrency-test.mjs
 */

const API_BASE = process.env.API_BASE_URL ?? "http://localhost:4000";

async function jsonFetch(path, options) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) },
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function main() {
  console.log(`Concurrency test against ${API_BASE}\n`);

  const trips = await jsonFetch("/api/trips");
  if (trips.status !== 200 || !Array.isArray(trips.body) || trips.body.length === 0) {
    throw new Error(
      "No trips found. Is the backend running (npm run dev) and seeded (npm run seed)?"
    );
  }
  const trip = trips.body[0];

  const stations = await jsonFetch(`/api/routes/${trip.routeId}/stations`);
  if (stations.status !== 200 || stations.body.length < 3) {
    throw new Error("Route needs at least 3 stations for this test to pick a non-trivial leg.");
  }
  const origin = stations.body[0];
  const destination = stations.body[2];

  const availability = await jsonFetch(
    `/api/trips/${trip.id}/availability?origin=${origin.id}&destination=${destination.id}`
  );
  if (availability.status !== 200) {
    throw new Error(`Could not fetch availability: ${JSON.stringify(availability.body)}`);
  }

  const reservedCoachWithSeat = availability.body.coaches.find(
    (c) => c.coachType === "reserved" && c.seats.some((s) => s.status === "available")
  );
  if (!reservedCoachWithSeat) {
    throw new Error(
      "No available reserved seat found for this leg. Re-seed the database or free up a seat and re-run."
    );
  }
  const seat = reservedCoachWithSeat.seats.find((s) => s.status === "available");

  console.log(
    `Racing two bookings for seat ${seat.seatNumber} (id ${seat.seatId}) on trip ${trip.id}, ` +
      `leg ${origin.name} -> ${destination.name}\n`
  );

  const [p1, p2] = await Promise.all([
    jsonFetch("/api/passengers", { method: "POST", body: JSON.stringify({ name: "Concurrency Test A" }) }),
    jsonFetch("/api/passengers", { method: "POST", body: JSON.stringify({ name: "Concurrency Test B" }) }),
  ]);
  if (p1.status !== 201 || p2.status !== 201) {
    throw new Error(`Failed to create test passengers: ${JSON.stringify([p1, p2])}`);
  }

  const bookingPayload = (passengerId) =>
    JSON.stringify({
      tripId: trip.id,
      seatId: seat.seatId,
      passengerId,
      originStationId: origin.id,
      destinationStationId: destination.id,
    });

  const [r1, r2] = await Promise.all([
    jsonFetch("/api/bookings", { method: "POST", body: bookingPayload(p1.body.id) }),
    jsonFetch("/api/bookings", { method: "POST", body: bookingPayload(p2.body.id) }),
  ]);

  console.log("Result A:", r1.status, JSON.stringify(r1.body));
  console.log("Result B:", r2.status, JSON.stringify(r2.body));

  const results = [r1, r2];
  const successes = results.filter((r) => r.status === 201);
  const conflicts = results.filter((r) => r.status === 409);

  if (successes.length === 1 && conflicts.length === 1) {
    console.log("\nPASS: exactly one booking succeeded (201) and the other was rejected (409 Conflict).");
  } else {
    throw new Error(
      `FAIL: expected exactly one 201 and one 409, got statuses [${results.map((r) => r.status).join(", ")}]`
    );
  }

  const winner = successes[0].body;
  const cleanup = await jsonFetch(`/api/bookings/${winner.id}`, { method: "DELETE" });
  if (cleanup.status === 200) {
    console.log(`Cleaned up: cancelled booking ${winner.id} so the seat is free for future runs.`);
  }
}

main().catch((err) => {
  console.error("\n" + (err.message ?? err));
  process.exit(1);
});
