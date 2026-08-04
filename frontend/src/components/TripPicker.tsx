import type { Trip } from "../api";
import { formatScheduledTime } from "../time";

interface Props {
  trips: Trip[];
  loading: boolean;
  selectedTripId: number | null;
  onChangeTrip: (tripId: number) => void;
}

export function TripPicker({ trips, loading, selectedTripId, onChangeTrip }: Props) {
  return (
    <div className="panel">
      <label>
        Train
        <select
          value={selectedTripId ?? ""}
          onChange={(e) => onChangeTrip(Number(e.target.value))}
          disabled={loading || trips.length === 0}
        >
          {trips.length === 0 && <option value="">{loading ? "Loading..." : "No trains for this leg"}</option>}
          {trips.map((t) => (
            <option key={t.id} value={t.id}>
              {t.trainName} ({t.trainNumber}) &middot; {formatScheduledTime(t.originScheduledDeparture)} &rarr;{" "}
              {formatScheduledTime(t.destinationScheduledArrival)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
