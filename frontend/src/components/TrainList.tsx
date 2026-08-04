import type { Trip } from "../api";
import { formatDurationBetween, formatScheduledTime } from "../time";

interface Props {
  trips: Trip[];
  loading: boolean;
  selectedTripId: number | null;
  onChangeTrip: (tripId: number) => void;
}

export function TrainList({ trips, loading, selectedTripId, onChangeTrip }: Props) {
  if (loading) {
    return <div className="panel train-list-panel hint">Loading trains...</div>;
  }

  if (trips.length === 0) {
    return <div className="panel train-list-panel hint">No trains match the current filters.</div>;
  }

  return (
    <div className="panel train-list-panel">
      <ul className="train-list">
        {trips.map((t) => {
          const selected = t.id === selectedTripId;
          return (
            <li key={t.id}>
              <button
                type="button"
                className={selected ? "train-row selected" : "train-row"}
                onClick={() => onChangeTrip(t.id)}
                aria-pressed={selected}
              >
                <span className="train-radio" aria-hidden="true" />
                <span className="train-main">
                  <span className="train-name">
                    {t.trainName} {t.trainNumber && <span className="train-number">({t.trainNumber})</span>}
                  </span>
                  <span className="train-times">
                    {formatScheduledTime(t.originScheduledDeparture)} &rarr;{" "}
                    {formatScheduledTime(t.destinationScheduledArrival)}
                  </span>
                </span>
                <span className="train-duration">
                  {formatDurationBetween(t.originScheduledDeparture, t.destinationScheduledArrival)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
