import { useCallback, useEffect, useState } from "react";
import "./App.css";
import { ApiError, api } from "./api";
import type { Availability, AvailabilitySeat, Booking, Passenger, Station, Trip } from "./api";
import { PassengerForm } from "./components/PassengerForm";
import { StationPicker } from "./components/StationPicker";
import { TripPicker } from "./components/TripPicker";
import { SeatMap } from "./components/SeatMap";
import { BookingPanel } from "./components/BookingPanel";

interface ActiveBooking {
  booking: Booking;
  seatNumber: string;
}

function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

function App() {
  const [routeId, setRouteId] = useState<number | null>(null);
  const [stations, setStations] = useState<Station[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [passenger, setPassenger] = useState<Passenger | null>(null);

  const [selectedDate, setSelectedDate] = useState<string>(todayDateString());
  const [originId, setOriginId] = useState<number | null>(null);
  const [destinationId, setDestinationId] = useState<number | null>(null);

  const [matchingTrips, setMatchingTrips] = useState<Trip[]>([]);
  const [matchingTripsLoading, setMatchingTripsLoading] = useState(false);
  const [selectedTripId, setSelectedTripId] = useState<number | null>(null);

  const [availability, setAvailability] = useState<Availability | null>(null);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);

  const [activeBooking, setActiveBooking] = useState<ActiveBooking | null>(null);
  const [bookingInFlight, setBookingInFlight] = useState(false);
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  const [bookingError, setBookingError] = useState<string | null>(null);

  // Discover the route and its stations once at startup — origin/destination
  // selection needs the station list before any trip has been chosen.
  useEffect(() => {
    (async () => {
      try {
        const routes = await api.getRoutes();
        if (routes.length === 0) {
          setLoadError("No routes found. Run `npm run seed` in backend/ first.");
          return;
        }
        const route = routes[0];
        setRouteId(route.id);
        const stationList = await api.getStations(route.id);
        setStations(stationList);
        setLoadError(null);
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : "Failed to load route data");
      }
    })();
  }, []);

  // Once the passenger has picked a date + a complete leg, look up which
  // trains actually run that leg on that date — origin/destination drive
  // trip discovery, not the other way around.
  useEffect(() => {
    if (routeId === null || originId === null || destinationId === null) {
      setMatchingTrips([]);
      setSelectedTripId(null);
      return;
    }
    (async () => {
      setMatchingTripsLoading(true);
      try {
        const trips = await api.getTrips({
          routeId,
          date: selectedDate || undefined,
          originStationId: originId,
          destinationStationId: destinationId,
        });
        setMatchingTrips(trips);
        setSelectedTripId(trips[0]?.id ?? null);
        setLoadError(null);
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : "Failed to load trains for this leg");
      } finally {
        setMatchingTripsLoading(false);
      }
    })();
  }, [routeId, selectedDate, originId, destinationId]);

  // Changing the leg invalidates anything already held on the old leg/trip.
  useEffect(() => {
    setActiveBooking(null);
    setAvailability(null);
  }, [originId, destinationId]);

  const refreshAvailability = useCallback(async () => {
    if (selectedTripId === null || originId === null || destinationId === null) return;
    setAvailabilityLoading(true);
    try {
      const result = await api.getAvailability(selectedTripId, originId, destinationId);
      setAvailability(result);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load seat availability");
    } finally {
      setAvailabilityLoading(false);
    }
  }, [selectedTripId, originId, destinationId]);

  useEffect(() => {
    setAvailability(null);
    refreshAvailability();
  }, [refreshAvailability]);

  const handleSelectSeat = async (seat: AvailabilitySeat) => {
    // Guard against a burst of clicks on different seats landing before the
    // first request's response disables the seat map: without this, each
    // click fires an independent POST /api/bookings for a *different* seat
    // (no conflict, since they don't overlap each other), all of which
    // succeed — but React state can only track one as `activeBooking`, so
    // the rest become invisible holds nobody can see or release from the
    // UI. Setting this synchronously, before the `await`, closes that
    // window; the seat map's `disabled` prop reflects it immediately.
    if (bookingInFlight) return;
    if (selectedTripId === null || !passenger || originId === null || destinationId === null) return;
    setBookingInFlight(true);
    setConflictMessage(null);
    setBookingError(null);
    try {
      const booking = await api.createBooking({
        tripId: selectedTripId,
        seatId: seat.seatId,
        passengerId: passenger.id,
        originStationId: originId,
        destinationStationId: destinationId,
      });
      setActiveBooking({ booking, seatNumber: seat.seatNumber });
      await refreshAvailability();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setConflictMessage(
          `${seat.seatNumber} was just booked by someone else for an overlapping leg. Availability has been refreshed.`
        );
        await refreshAvailability();
      } else {
        setBookingError(err instanceof Error ? err.message : "Failed to create booking");
      }
    } finally {
      setBookingInFlight(false);
    }
  };

  const handleConfirm = async () => {
    if (!activeBooking) return;
    const confirmed = await api.confirmBooking(activeBooking.booking.id);
    setActiveBooking({ ...activeBooking, booking: confirmed });
    await refreshAvailability();
  };

  const handleCancel = async () => {
    if (!activeBooking) return;
    await api.cancelBooking(activeBooking.booking.id);
    setActiveBooking(null);
    await refreshAvailability();
  };

  const handleExpired = useCallback(async () => {
    setActiveBooking(null);
    setBookingError("Your hold expired before it was confirmed. The seat has been released.");
    await refreshAvailability();
  }, [refreshAvailability]);

  const originStation = stations.find((s) => s.id === originId) ?? null;
  const destinationStation = stations.find((s) => s.id === destinationId) ?? null;
  const selectedTrip = matchingTrips.find((t) => t.id === selectedTripId) ?? null;

  const reservedCoaches = availability?.coaches.filter((c) => c.coachType === "reserved") ?? [];
  const unreservedCoaches = availability?.coaches.filter((c) => c.coachType === "unreserved") ?? [];

  const legChosen = originId !== null && destinationId !== null;

  return (
    <div className="app">
      <header className="app-header">
        <h1>Colombo Fort &ndash; Badulla</h1>
        {selectedTrip && (
          <p className="trip-meta">
            {selectedTrip.trainName} {selectedTrip.trainNumber ? `(${selectedTrip.trainNumber})` : ""} &middot;
            departs {selectedTrip.departureTime.slice(0, 5)} &middot; {selectedTrip.serviceDate}
          </p>
        )}
      </header>

      {loadError && <div className="banner banner-error">{loadError}</div>}

      <div className="app-body">
        <aside className="sidebar">
          <PassengerForm
            passenger={passenger}
            onPassengerCreated={setPassenger}
            onReset={() => setPassenger(null)}
          />

          <div className="panel">
            <label>
              Date
              <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} />
            </label>
          </div>

          <StationPicker
            stations={stations}
            originId={originId}
            destinationId={destinationId}
            onChangeOrigin={setOriginId}
            onChangeDestination={setDestinationId}
          />

          {!legChosen && <p className="hint">Choose an origin and destination to see available trains.</p>}

          {legChosen && (
            <TripPicker
              trips={matchingTrips}
              loading={matchingTripsLoading}
              selectedTripId={selectedTripId}
              onChangeTrip={setSelectedTripId}
            />
          )}

          {!passenger && <p className="hint">Enter your name to start booking a seat.</p>}

          {activeBooking && originStation && destinationStation && (
            <BookingPanel
              booking={activeBooking.booking}
              originName={originStation.name}
              destinationName={destinationStation.name}
              seatNumber={activeBooking.seatNumber}
              onConfirm={handleConfirm}
              onCancel={handleCancel}
              onExpired={handleExpired}
              onBookAnother={() => setActiveBooking(null)}
            />
          )}

          {bookingError && <p className="error-text">{bookingError}</p>}
        </aside>

        <main className="main-panel">
          {conflictMessage && (
            <div className="banner banner-conflict">
              {conflictMessage}
              <button className="link-button" onClick={() => setConflictMessage(null)}>
                dismiss
              </button>
            </div>
          )}

          {legChosen && !matchingTripsLoading && matchingTrips.length === 0 && (
            <div className="panel">
              No trains run this leg on {selectedDate || "any seeded date"}. Try a different date.
            </div>
          )}

          {availabilityLoading && <p className="hint">Loading seat map...</p>}

          {!availabilityLoading && availability && (
            <SeatMap
              reservedCoaches={reservedCoaches}
              unreservedCoaches={unreservedCoaches}
              onSelectSeat={handleSelectSeat}
              disabled={!passenger || bookingInFlight || activeBooking?.booking.status === "held"}
            />
          )}

          {!availabilityLoading && !availability && legChosen && matchingTrips.length > 0 && (
            <div className="panel">Select a train to see the seat map.</div>
          )}

          {!availabilityLoading && !availability && !legChosen && (
            <div className="panel">Select an origin and destination to get started.</div>
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
