import type { Station } from "../api";

interface Props {
  stations: Station[];
  originId: number | null;
  destinationId: number | null;
  onChangeOrigin: (id: number | null) => void;
  onChangeDestination: (id: number | null) => void;
}

export function StationPicker({ stations, originId, destinationId, onChangeOrigin, onChangeDestination }: Props) {
  const origin = stations.find((s) => s.id === originId) ?? null;

  // Destination must come after origin along the route — enforced here in
  // the UI, and again server-side by the trip_stop composite FK / sequence
  // check when the booking is created.
  const destinationOptions = origin ? stations.filter((s) => s.sequence > origin.sequence) : stations;

  return (
    <div className="panel">
      <label>
        Origin
        <select
          value={originId ?? ""}
          onChange={(e) => {
            const id = e.target.value ? Number(e.target.value) : null;
            onChangeOrigin(id);
            if (destinationId !== null) {
              const dest = stations.find((s) => s.id === destinationId);
              const newOrigin = stations.find((s) => s.id === id);
              if (dest && newOrigin && dest.sequence <= newOrigin.sequence) {
                onChangeDestination(null);
              }
            }
          }}
        >
          <option value="">Select origin</option>
          {stations.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>

      <label>
        Destination
        <select
          value={destinationId ?? ""}
          onChange={(e) => onChangeDestination(e.target.value ? Number(e.target.value) : null)}
          disabled={!origin}
        >
          <option value="">Select destination</option>
          {destinationOptions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
