import type { Trip } from "../api";

interface Props {
  trips: Trip[];
  loading: boolean;
  selectedDate: string;
  onChangeDate: (date: string) => void;
  selectedTripId: number | null;
  onChangeTrip: (tripId: number) => void;
}

export function TripPicker({ trips, loading, selectedDate, onChangeDate, selectedTripId, onChangeTrip }: Props) {
  return (
    <div className="panel">
      <label>
        Date
        <div className="date-row">
          <input type="date" value={selectedDate} onChange={(e) => onChangeDate(e.target.value)} />
          {selectedDate && (
            <button type="button" className="link-button" onClick={() => onChangeDate("")}>
              show all
            </button>
          )}
        </div>
      </label>

      <label>
        Trip
        <select
          value={selectedTripId ?? ""}
          onChange={(e) => onChangeTrip(Number(e.target.value))}
          disabled={loading || trips.length === 0}
        >
          {trips.length === 0 && <option value="">No trips found</option>}
          {trips.map((t) => (
            <option key={t.id} value={t.id}>
              {t.serviceDate} &middot; {t.trainName} ({t.trainNumber}) &middot; {t.departureTime.slice(0, 5)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
