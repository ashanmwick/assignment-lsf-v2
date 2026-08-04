export class AppError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "AppError";
  }
}

export const NotFound = (message: string) => new AppError(404, message);
export const BadRequest = (message: string) => new AppError(400, message);
export const Conflict = (message: string) => new AppError(409, message);

/** Postgres error code for an EXCLUDE constraint violation. */
export const PG_EXCLUSION_VIOLATION = "23P01";

export function isPgError(err: unknown): err is { code: string; detail?: string; constraint?: string } {
  return typeof err === "object" && err !== null && "code" in err;
}
