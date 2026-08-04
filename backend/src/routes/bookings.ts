import { Router } from "express";
import { BadRequest, NotFound } from "../errors";
import { cancelBooking, confirmBooking, createHeldBooking, getBookingDetail } from "../services/bookings";

export const bookingsRouter = Router();

function toInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

// POST /api/bookings — create a 'held' booking for one seat/leg.
bookingsRouter.post("/bookings", async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const tripId = toInt(body.tripId);
    const seatId = toInt(body.seatId);
    const passengerId = toInt(body.passengerId);
    const originStationId = toInt(body.originStationId);
    const destinationStationId = toInt(body.destinationStationId);

    if (!tripId || !seatId || !passengerId || !originStationId || !destinationStationId) {
      throw BadRequest(
        "tripId, seatId, passengerId, originStationId and destinationStationId are all required"
      );
    }

    const booking = await createHeldBooking({
      tripId,
      seatId,
      passengerId,
      originStationId,
      destinationStationId,
    });

    res.status(201).json(booking);
  } catch (err) {
    next(err);
  }
});

// POST /api/bookings/:id/confirm — move a held booking to confirmed.
bookingsRouter.post("/bookings/:id/confirm", async (req, res, next) => {
  try {
    const id = toInt(req.params.id);
    if (!id) throw BadRequest("id must be an integer");

    const booking = await confirmBooking(id);
    res.json(booking);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/bookings/:id — cancel a held or confirmed booking.
bookingsRouter.delete("/bookings/:id", async (req, res, next) => {
  try {
    const id = toInt(req.params.id);
    if (!id) throw BadRequest("id must be an integer");

    const booking = await cancelBooking(id);
    res.json(booking);
  } catch (err) {
    next(err);
  }
});

// GET /api/bookings/:id — booking detail.
bookingsRouter.get("/bookings/:id", async (req, res, next) => {
  try {
    const id = toInt(req.params.id);
    if (!id) throw BadRequest("id must be an integer");

    const booking = await getBookingDetail(id);
    if (!booking) throw NotFound(`Booking ${id} not found`);
    res.json(booking);
  } catch (err) {
    next(err);
  }
});
