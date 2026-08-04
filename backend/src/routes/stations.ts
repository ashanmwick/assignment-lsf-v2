import { Router } from "express";
import { pool } from "../db";
import { BadRequest } from "../errors";

export const stationsRouter = Router();

// GET /api/routes/:routeId/stations — ordered list of stations on the route.
stationsRouter.get("/routes/:routeId/stations", async (req, res, next) => {
  try {
    const routeId = Number(req.params.routeId);
    if (!Number.isInteger(routeId)) throw BadRequest("routeId must be an integer");

    const { rows } = await pool.query(
      `SELECT s.id, s.name, s.code, rs.sequence, rs.distance_km
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
      }))
    );
  } catch (err) {
    next(err);
  }
});
