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

export interface Station {
  id: number;
  name: string;
  code: string | null;
  sequence: number;
  distanceKm: number;
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
  origin: { stationId: number; sequence: number; distanceKm: number };
  destination: { stationId: number; sequence: number; distanceKm: number };
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
}

export const api = {
  getStations: (routeId: number) => request<Station[]>(`/api/routes/${routeId}/stations`),

  getTrips: (filters?: { routeId?: number; date?: string }) => {
    const params = new URLSearchParams();
    if (filters?.routeId !== undefined) params.set("routeId", String(filters.routeId));
    if (filters?.date) params.set("date", filters.date);
    const query = params.toString();
    return request<Trip[]>(`/api/trips${query ? `?${query}` : ""}`);
  },

  getAvailability: (tripId: number, originStationId: number, destinationStationId: number) =>
    request<Availability>(
      `/api/trips/${tripId}/availability?origin=${originStationId}&destination=${destinationStationId}`
    ),

  createPassenger: (name: string, email?: string) =>
    request<Passenger>("/api/passengers", {
      method: "POST",
      body: JSON.stringify({ name, email: email || undefined }),
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
