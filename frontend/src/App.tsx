import { useCallback, useEffect, useState } from "react";
import "./App.css";
import { ApiError, api } from "./api";
import type { Availability, AvailabilitySeat, Booking, Passenger, Station, Trip } from "./api";
import { PassengerForm } from "./components/PassengerForm";
import { TripPicker } from "./components/TripPicker";
import { StationPicker } from "./components/StationPicker";
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
  const [selectedDate, setSelectedDate] = useState<string>(todayDateString());
  const [trips, setTrips] = useState<Trip[]>([]);
  const [tripsLoading, setTripsLoading] = useState(false);
  const [selectedTripId, setSelectedTripId] = useState<number | null>(null);

  const [stations, setStations] = useState<Station[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [passenger, setPassenger] = useState<Passenger | null>(null);

  const [originId, setOriginId] = useState<number | null>(null);
  const [destinationId, setDestinationId] = useState<number | null>(null);

  const [availability, setAvailability] = useState<Availability | null>(null);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);

  const [activeBooking, setActiveBooking] = useState<ActiveBooking | null>(null);
  const [bookingInFlight, setBookingInFlight] = useState(false);
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  const [bookingError, setBookingError] = useState<string | null>(null);

  // Reload the trip list whenever the date filter changes (empty = all
  // upcoming trips). Keeps the currently-selected trip if it's still in the
  // new list, otherwise falls back to the first trip.
  useEffect(() => {
    (async () => {
      setTripsLoading(true);
      try {
        const list = await api.getTrips(selectedDate ? { date: selectedDate } : undefined);
        setTrips(list);
        setSelectedTripId((current) => {
          if (current !== null && list.some((t) => t.id === current)) return current;
          return list[0]?.id ?? null;
        });
        if (list.length === 0) {
          setLoadError(
            selectedDate
              ? `No trips found on ${selectedDate}. Try a different date or run \`npm run seed\` in backend/.`
              : "No trips found. Run `npm run seed` in backend/ first."
          );
        } else {
          setLoadError(null);
        }
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : "Failed to load trips");
      } finally {
        setTripsLoading(false);
      }
    })();
  }, [selectedDate]);

  const selectedTrip = trips.find((t) => t.id === selectedTripId) ?? null;

  // When the selected trip changes, load its route's stations and reset
  // every downstream choice — origin/destination sequences and seat
  // availability are specific to one trip.
  useEffect(() => {
    setOriginId(null);
    setDestinationId(null);
    setAvailability(null);
    setActiveBooking(null);
    if (!selectedTrip) {
      setStations([]);
      return;
    }
    (async () => {
      try {
        const stationList = await api.getStations(selectedTrip.routeId);
        setStations(stationList);
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : "Failed to load stations");
      }
    })();
  }, [selectedTrip?.id, selectedTrip?.routeId]);

  const refreshAvailability = useCallback(async () => {
    if (!selectedTrip || originId === null || destinationId === null) return;
    setAvailabilityLoading(true);
    try {
      const result = await api.getAvailability(selectedTrip.id, originId, destinationId);
      setAvailability(result);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load seat availability");
    } finally {
      setAvailabilityLoading(false);
    }
  }, [selectedTrip, originId, destinationId]);

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
    if (!selectedTrip || !passenger || originId === null || destinationId === null) return;
    setBookingInFlight(true);
    setConflictMessage(null);
    setBookingError(null);
    try {
      const booking = await api.createBooking({
        tripId: selectedTrip.id,
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

  const reservedCoaches = availability?.coaches.filter((c) => c.coachType === "reserved") ?? [];
  const unreservedCoaches = availability?.coaches.filter((c) => c.coachType === "unreserved") ?? [];

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
          <TripPicker
            trips={trips}
            loading={tripsLoading}
            selectedDate={selectedDate}
            onChangeDate={setSelectedDate}
            selectedTripId={selectedTripId}
            onChangeTrip={setSelectedTripId}
          />

          <PassengerForm
            passenger={passenger}
            onPassengerCreated={setPassenger}
            onReset={() => setPassenger(null)}
          />

          <StationPicker
            stations={stations}
            originId={originId}
            destinationId={destinationId}
            onChangeOrigin={setOriginId}
            onChangeDestination={setDestinationId}
          />

          {!passenger && <p className="hint">Enter your name to start booking a seat.</p>}
          {passenger && (!originId || !destinationId) && (
            <p className="hint">Choose an origin and destination to see seat availability.</p>
          )}

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

          {availabilityLoading && <p className="hint">Loading seat map...</p>}

          {!availabilityLoading && availability && (
            <SeatMap
              reservedCoaches={reservedCoaches}
              unreservedCoaches={unreservedCoaches}
              onSelectSeat={handleSelectSeat}
              disabled={!passenger || bookingInFlight || activeBooking?.booking.status === "held"}
            />
          )}

          {!availabilityLoading && !availability && (
            <div className="panel">Select an origin and destination to see the seat map.</div>
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
