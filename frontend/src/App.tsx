import { useCallback, useEffect, useMemo, useState } from "react";
import "./App.css";
import { ApiError, api } from "./api";
import type { Availability, AvailabilitySeat, Booking, Passenger, Station, Trip } from "./api";
import { formatScheduledTime } from "./time";
import { PassengerBadge } from "./components/PassengerBadge";
import { PassengerModal } from "./components/PassengerModal";
import { StationPicker } from "./components/StationPicker";
import { TimeRangePicker } from "./components/TimeRangePicker";
import { TrainList } from "./components/TrainList";
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
  const [pendingSeat, setPendingSeat] = useState<AvailabilitySeat | null>(null);

  const [selectedDate, setSelectedDate] = useState<string>(todayDateString());
  const [originId, setOriginId] = useState<number | null>(null);
  const [destinationId, setDestinationId] = useState<number | null>(null);
  const [departsAfter, setDepartsAfter] = useState<string>("");
  const [departsBefore, setDepartsBefore] = useState<string>("");

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

  // Once a date + a complete leg is chosen, look up which trains actually
  // run that leg on that date — origin/destination drive trip discovery,
  // not the other way around.
  useEffect(() => {
    if (routeId === null || originId === null || destinationId === null) {
      setMatchingTrips([]);
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
        setLoadError(null);
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : "Failed to load trains for this leg");
      } finally {
        setMatchingTripsLoading(false);
      }
    })();
  }, [routeId, selectedDate, originId, destinationId]);

  // Narrow the leg's trains down to the requested departure time-of-day
  // range. Filtered client-side against the (small, already-fetched) leg
  // match list rather than round-tripping to the server again.
  const visibleTrips = useMemo(() => {
    if (!departsAfter && !departsBefore) return matchingTrips;
    return matchingTrips.filter((t) => {
      const time = formatScheduledTime(t.originScheduledDeparture);
      if (departsAfter && time < departsAfter) return false;
      if (departsBefore && time > departsBefore) return false;
      return true;
    });
  }, [matchingTrips, departsAfter, departsBefore]);

  // Keep the selected train in sync with whatever's currently visible:
  // default to the first match, but only reset it when the previous
  // selection has actually fallen out of view.
  useEffect(() => {
    setSelectedTripId((current) => {
      if (current !== null && visibleTrips.some((t) => t.id === current)) return current;
      return visibleTrips[0]?.id ?? null;
    });
  }, [visibleTrips]);

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

  const bookSeat = async (seat: AvailabilitySeat, bookingPassenger: Passenger) => {
    if (selectedTripId === null || originId === null || destinationId === null) return;
    setBookingInFlight(true);
    setConflictMessage(null);
    setBookingError(null);
    try {
      const booking = await api.createBooking({
        tripId: selectedTripId,
        seatId: seat.seatId,
        passengerId: bookingPassenger.id,
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

  const handleSelectSeat = async (seat: AvailabilitySeat) => {
    // Guard against a burst of clicks on different seats landing before the
    // first request's response disables the seat map: without this, each
    // click fires an independent POST /api/bookings for a *different* seat
    // (no conflict, since they don't overlap each other), all of which
    // succeed — but React state can only track one as `activeBooking`, so
    // the rest become invisible holds nobody can see or release from the
    // UI. Setting this synchronously, before the `await`, closes that
    // window; the seat map's `disabled` prop reflects it immediately.
    if (bookingInFlight || pendingSeat) return;
    if (selectedTripId === null || originId === null || destinationId === null) return;

    if (!passenger) {
      // Don't ask for passenger details until the moment they're actually
      // needed — right before this seat's hold is created — rather than
      // upfront when the page loads.
      setPendingSeat(seat);
      return;
    }
    await bookSeat(seat, passenger);
  };

  const handlePassengerModalSubmit = async (newPassenger: Passenger) => {
    setPassenger(newPassenger);
    const seat = pendingSeat;
    setPendingSeat(null);
    if (seat) await bookSeat(seat, newPassenger);
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
  const selectedTrip = visibleTrips.find((t) => t.id === selectedTripId) ?? null;

  const reservedCoaches = availability?.coaches.filter((c) => c.coachType === "reserved") ?? [];
  const unreservedCoaches = availability?.coaches.filter((c) => c.coachType === "unreserved") ?? [];

  const legChosen = originId !== null && destinationId !== null;
  const showSeatStep = legChosen && !!selectedTripId;

  return (
    <div className="app">
      <header className="app-header">
        <h1>Colombo Fort &ndash; Badulla</h1>
        <p className="trip-meta">
          {selectedTrip && originStation && destinationStation ? (
            <>
              {selectedTrip.trainName} {selectedTrip.trainNumber ? `(${selectedTrip.trainNumber})` : ""} &middot;{" "}
              {originStation.name} {formatScheduledTime(selectedTrip.originScheduledDeparture)} &rarr;{" "}
              {destinationStation.name} {formatScheduledTime(selectedTrip.destinationScheduledArrival)} &middot;{" "}
              {selectedTrip.serviceDate}
            </>
          ) : (
            "Search for a train to see the schedule."
          )}
        </p>
      </header>

      {loadError && <div className="banner banner-error">{loadError}</div>}
      {conflictMessage && (
        <div className="banner banner-conflict">
          {conflictMessage}
          <button className="link-button" onClick={() => setConflictMessage(null)}>
            dismiss
          </button>
        </div>
      )}

      <div className="filter-bar panel">
        <label>
          Date
          <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} />
        </label>
        <StationPicker
          stations={stations}
          originId={originId}
          destinationId={destinationId}
          onChangeOrigin={setOriginId}
          onChangeDestination={setDestinationId}
        />
        <TimeRangePicker
          from={departsAfter}
          to={departsBefore}
          onChangeFrom={setDepartsAfter}
          onChangeTo={setDepartsBefore}
        />
      </div>

      {!legChosen && <p className="hint">Choose an origin and destination to see available trains.</p>}

      {legChosen && (
        <TrainList
          trips={visibleTrips}
          loading={matchingTripsLoading}
          selectedTripId={selectedTripId}
          onChangeTrip={setSelectedTripId}
        />
      )}

      {legChosen && !matchingTripsLoading && visibleTrips.length === 0 && (
        <div className="panel">
          No trains run this leg on {selectedDate || "any seeded date"}
          {(departsAfter || departsBefore) && " in the selected time range"}. Try a different
          {matchingTrips.length > 0 && !visibleTrips.length ? " time range" : " date"}.
        </div>
      )}

      {availabilityLoading && <p className="hint">Loading seat map...</p>}

      {!availabilityLoading && availability && (
        <SeatMap
          reservedCoaches={reservedCoaches}
          unreservedCoaches={unreservedCoaches}
          onSelectSeat={handleSelectSeat}
          disabled={bookingInFlight || pendingSeat !== null || activeBooking?.booking.status === "held"}
        />
      )}

      {!availabilityLoading && !availability && showSeatStep && (
        <div className="panel">Loading seat map...</div>
      )}

      {!availabilityLoading && !availability && !legChosen && (
        <div className="panel">Select an origin and destination to get started.</div>
      )}

      {bookingError && <p className="error-text">{bookingError}</p>}

      {showSeatStep && (
        <div className="booking-summary-bar">
          <div className="booking-summary-bar-inner">
            {passenger && <PassengerBadge passenger={passenger} onChange={() => setPassenger(null)} />}

            {activeBooking && originStation && destinationStation ? (
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
            ) : (
              <div className="booking-summary booking-empty">
                <span className="booking-summary-label">No seat selected yet</span>
                <button disabled>Continue</button>
              </div>
            )}
          </div>
        </div>
      )}

      {pendingSeat && (
        <PassengerModal
          seatNumber={pendingSeat.seatNumber}
          onSubmit={handlePassengerModalSubmit}
          onCancel={() => setPendingSeat(null)}
        />
      )}
    </div>
  );
}

export default App;
