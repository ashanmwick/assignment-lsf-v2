import { pool } from "./db";
import { config } from "./config";

/**
 * The booking.EXCLUDE constraint's WHERE (status IN ('held','confirmed'))
 * predicate has no idea what `held_until` means — an expired-but-still-'held'
 * row keeps blocking new bookings on that seat/segment until something flips
 * its status to 'cancelled'. The hot path (POST /api/bookings) does a
 * narrowly-scoped sweep itself so an expired hold on the seat being
 * requested never falsely blocks that specific attempt. This background
 * sweeper is the backstop: it periodically cancels *all* globally expired
 * holds so seat-availability reads and admin views stay accurate even when
 * nobody happens to be booking that seat right now.
 *
 * A `setInterval` is adequate for this assignment's scope. A production
 * deployment would run this as a scheduled job (e.g. pg_cron, or a worker
 * queue tick) so it survives API process restarts and doesn't run once per
 * server instance if the API is horizontally scaled.
 */
export function startHoldSweeper(): NodeJS.Timeout {
  const sweep = async () => {
    try {
      const result = await pool.query(
        `UPDATE booking
         SET status = 'cancelled'
         WHERE status = 'held' AND held_until < now()`
      );
      if (result.rowCount) {
        console.log(`[sweeper] cancelled ${result.rowCount} expired hold(s)`);
      }
    } catch (err) {
      console.error("[sweeper] failed to sweep expired holds", err);
    }
  };

  const interval = setInterval(sweep, config.sweeperIntervalSeconds * 1000);
  void sweep();
  return interval;
}
