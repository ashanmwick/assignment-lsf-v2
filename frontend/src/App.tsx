import { useCallback, useEffect, useState } from "react";
import "./App.css";
import { ApiError, api } from "./api";
import type { Availability, AvailabilitySeat, Booking, Passenger, Station, Trip } from "./api";
import { PassengerForm } from "./components/PassengerForm";
import { StationPicker } from "./components/StationPicker";
import { SeatMap } from "./components/SeatMap";
import { BookingPanel } from "./components/BookingPanel";

interface ActiveBooking {
  booking: Booking;
  seatNumber: string;
}

function App() {
  const [trip, setTrip] = useState<Trip | null>(null);
  const [stations, setStations] = useState<Station[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [passenger, setPassenger] = useState<Passenger | null>(null);

  const [originId, setOriginId] = useState<number | null>(null);
  const [destinationId, setDestinationId] = useState<number | null>(null);

  const [availability, setAvailability] = useState<Availability | null>(null);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);

  const [activeBooking, setActiveBooking] = useState<ActiveBooking | null>(null);
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  const [bookingError, setBookingError] = useState<string | null>(null);

  // Load the (single, seeded) trip and its route's stations on mount.
  useEffect(() => {
    (async () => {
      try {
        const trips = await api.getTrips();
        if (trips.length === 0) {
          setLoadError("No trips found. Run `npm run seed` in backend/ first.");
          return;
        }
        const firstTrip = trips[0];
        setTrip(firstTrip);
        const stationList = await api.getStations(firstTrip.routeId);
        setStations(stationList);
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : "Failed to load trip data");
      }
    })();
  }, []);

  const refreshAvailability = useCallback(async () => {
    if (!trip || originId === null || destinationId === null) return;
    setAvailabilityLoading(true);
    try {
      const result = await api.getAvailability(trip.id, originId, destinationId);
      setAvailability(result);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load seat availability");
    } finally {
      setAvailabilityLoading(false);
    }
  }, [trip, originId, destinationId]);

  useEffect(() => {
    setAvailability(null);
    refreshAvailability();
  }, [refreshAvailability]);

  const handleSelectSeat = async (seat: AvailabilitySeat) => {
    if (!trip || !passenger || originId === null || destinationId === null) return;
    setConflictMessage(null);
    setBookingError(null);
    try {
      const booking = await api.createBooking({
        tripId: trip.id,
        seatId: seat.seatId,
        passengerId: passenger.id,
        originStationId: originId,
        destinationStationId: destinationId,
      });
      setActiveBooking({ booking, seatNumber: seat.seatNumber });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setConflictMessage(
          `${seat.seatNumber} was just booked by someone else for an overlapping leg. Availability has been refreshed.`
        );
        await refreshAvailability();
      } else {
        setBookingError(err instanceof Error ? err.message : "Failed to create booking");
      }
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
        {trip && (
          <p className="trip-meta">
            {trip.trainName} {trip.trainNumber ? `(${trip.trainNumber})` : ""} &middot; departs{" "}
            {trip.departureTime.slice(0, 5)} &middot; {trip.serviceDate}
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
              disabled={!passenger || activeBooking?.booking.status === "held"}
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
