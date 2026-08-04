import "dotenv/config";

export const config = {
  port: Number(process.env.PORT ?? 4000),
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  holdDurationMinutes: Number(process.env.HOLD_DURATION_MINUTES ?? 7),
  sweeperIntervalSeconds: Number(process.env.SWEEPER_INTERVAL_SECONDS ?? 30),
};
