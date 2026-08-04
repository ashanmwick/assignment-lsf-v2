export const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : `Request failed with status ${res.status}`;
    throw new ApiError(res.status, message);
  }
  return body as T;
}

export interface Route {
  id: number;
  name: string;
}

export interface Station {
  id: number;
  name: string;
  code: string | null;
  sequence: number;
  distanceKm: number;
  /** Minutes from the route's nominal start — a schedule template, not an
   * absolute time (no trip is in view at the station-picker stage). */
  offsetMinutes: number;
}

export interface Trip {
  id: number;
  routeId: number;
  routeName: string;
  trainId: number;
  trainName: string;
  trainNumber: string | null;
  departureTime: string;
  serviceDate: string;
  /** Only present when the trip list was fetched with an origin+destination
   * filter — the requested leg's scheduled departure/arrival. */
  originScheduledDeparture: string | null;
  destinationScheduledArrival: string | null;
}

export type SeatStatus = "available" | "held" | "confirmed";

export interface AvailabilitySeat {
  seatId: number;
  seatNumber: string;
  row: number | null;
  column: number | null;
  seatType: string | null;
  status: SeatStatus;
}

export interface AvailabilityCoach {
  coachId: number;
  coachNumber: string;
  coachType: "reserved" | "unreserved";
  totalSeats: number;
  positionInTrain: number;
  seats: AvailabilitySeat[];
}

export interface Availability {
  tripId: number;
  origin: { stationId: number; sequence: number; distanceKm: number; scheduledDeparture: string | null };
  destination: { stationId: number; sequence: number; distanceKm: number; scheduledArrival: string | null };
  coaches: AvailabilityCoach[];
}

export interface Passenger {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
}

export interface Booking {
  id: number;
  tripId: number;
  coachId: number;
  seatId: number;
  passengerId: number;
  originStationId: number;
  destinationStationId: number;
  originSeq: number;
  destinationSeq: number;
  fare: number;
  status: "held" | "confirmed" | "cancelled";
  heldUntil: string | null;
  createdAt: string;
  originScheduledDeparture: string | null;
  destinationScheduledArrival: string | null;
}

export const api = {
  getRoutes: () => request<Route[]>("/api/routes"),

  getStations: (routeId: number) => request<Station[]>(`/api/routes/${routeId}/stations`),

  getTrips: (filters?: { routeId?: number; date?: string; originStationId?: number; destinationStationId?: number }) => {
    const params = new URLSearchParams();
    if (filters?.routeId !== undefined) params.set("routeId", String(filters.routeId));
    if (filters?.date) params.set("date", filters.date);
    if (filters?.originStationId !== undefined) params.set("origin", String(filters.originStationId));
    if (filters?.destinationStationId !== undefined) params.set("destination", String(filters.destinationStationId));
    const query = params.toString();
    return request<Trip[]>(`/api/trips${query ? `?${query}` : ""}`);
  },

  getAvailability: (tripId: number, originStationId: number, destinationStationId: number) =>
    request<Availability>(
      `/api/trips/${tripId}/availability?origin=${originStationId}&destination=${destinationStationId}`
    ),

  createPassenger: (name: string, phone: string) =>
    request<Passenger>("/api/passengers", {
      method: "POST",
      body: JSON.stringify({ name, phone }),
    }),

  createBooking: (input: {
    tripId: number;
    seatId: number;
    passengerId: number;
    originStationId: number;
    destinationStationId: number;
  }) => request<Booking>("/api/bookings", { method: "POST", body: JSON.stringify(input) }),

  confirmBooking: (id: number) => request<Booking>(`/api/bookings/${id}/confirm`, { method: "POST" }),

  cancelBooking: (id: number) => request<Booking>(`/api/bookings/${id}`, { method: "DELETE" }),
};
