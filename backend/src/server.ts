import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import { config } from "./config";
import { AppError } from "./errors";
import { stationsRouter } from "./routes/stations";
import { tripsRouter } from "./routes/trips";
import { bookingsRouter } from "./routes/bookings";
import { passengersRouter } from "./routes/passengers";
import { startHoldSweeper } from "./sweeper";

const app = express();

app.use(cors({ origin: config.corsOrigin }));
app.use(express.json());

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.use("/api", stationsRouter);
app.use("/api", tripsRouter);
app.use("/api", bookingsRouter);
app.use("/api", passengersRouter);

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(config.port, () => {
  console.log(`API listening on http://localhost:${config.port}`);
  startHoldSweeper();
});
