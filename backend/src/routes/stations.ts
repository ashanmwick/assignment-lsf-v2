import { Router } from "express";
import { pool } from "../db";
import { BadRequest } from "../errors";

export const stationsRouter = Router();

// GET /api/routes — list every route. The frontend picks origin/destination
// against a route's stations before it knows which trip it'll end up
// booking, so routes need to be discoverable independent of any trip.
stationsRouter.get("/routes", async (_req, res, next) => {
  try {
    const { rows } = await pool.query(`SELECT id, name FROM route ORDER BY id ASC`);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/routes/:routeId/stations — ordered list of stations on the route.
stationsRouter.get("/routes/:routeId/stations", async (req, res, next) => {
  try {
    const routeId = Number(req.params.routeId);
    if (!Number.isInteger(routeId)) throw BadRequest("routeId must be an integer");

    const { rows } = await pool.query(
      `SELECT s.id, s.name, s.code, rs.sequence, rs.distance_km, rs.offset_minutes
       FROM route_station rs
       JOIN station s ON s.id = rs.station_id
       WHERE rs.route_id = $1
       ORDER BY rs.sequence ASC`,
      [routeId]
    );

    res.json(
      rows.map((r) => ({
        id: r.id,
        name: r.name,
        code: r.code,
        sequence: r.sequence,
        distanceKm: Number(r.distance_km),
        // Minutes from the route's nominal start — a schedule *template*,
        // not an absolute time (no trip/departure_time is known yet at this
        // endpoint). Absolute scheduled_arrival/scheduled_departure appear
        // once a trip is in view: GET /api/trips (leg-filtered),
        // .../availability, and booking responses. See README.
        offsetMinutes: r.offset_minutes,
      }))
    );
  } catch (err) {
    next(err);
  }
});
