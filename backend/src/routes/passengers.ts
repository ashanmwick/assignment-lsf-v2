import { Router } from "express";
import { pool } from "../db";
import { BadRequest } from "../errors";

export const passengersRouter = Router();

// POST /api/passengers — minimal passenger identity creation. Not listed in
// the assignment's endpoint list, but POST /api/bookings requires an
// existing passengerId, so the frontend needs some way to obtain one.
passengersRouter.post("/passengers", async (req, res, next) => {
  try {
    const { name, email, phone } = req.body ?? {};
    if (typeof name !== "string" || name.trim().length === 0) {
      throw BadRequest("name is required");
    }

    const { rows } = await pool.query(
      `INSERT INTO passenger (name, email, phone) VALUES ($1, $2, $3) RETURNING *`,
      [name.trim(), email ?? null, phone ?? null]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});
