import { Pool, type PoolClient, types } from "pg";
import "dotenv/config";

// By default node-postgres parses DATE columns into a JS Date at local
// midnight, which then serializes to JSON (UTC) as the *previous* day for
// any timezone ahead of UTC — e.g. service_date '2026-08-04' round-trips as
// "2026-08-03T18:30:00.000Z" on a UTC+5:30 host. DATE has no timezone
// concept, so return it as the raw 'YYYY-MM-DD' string instead (OID 1082).
types.setTypeParser(1082, (val: string) => val);

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  // Fail loudly at startup rather than silently falling back to a default
  // connection (e.g. localhost) that could point at the wrong database.
  throw new Error(
    "DATABASE_URL is not set. Copy backend/.env.example to backend/.env and " +
      "fill in your Supabase connection string before starting the server."
  );
}

export const pool = new Pool({ connectionString });

/**
 * Runs `fn` inside a single client checked out from the pool, wrapped in an
 * explicit BEGIN/COMMIT/ROLLBACK transaction. Every booking-mutating flow
 * goes through this so the lazy sweep + insert (or status transition) is
 * atomic — never split implicitly across separate pool connections.
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
