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

  // Trips can run in either direction (southbound Colombo Fort -> Badulla,
  // or northbound the other way — each a genuinely separate trip with its
  // own trip_stop sequence), so any station pair is a selectable leg here;
  // only the same station twice is excluded. Which pairs actually have a
  // train serving them is determined by the leg-filtered trip list, not by
  // this picker.
  const destinationOptions = origin ? stations.filter((s) => s.id !== origin.id) : stations;

  return (
    <>
      <label>
        Origin
        <select
          value={originId ?? ""}
          onChange={(e) => {
            const id = e.target.value ? Number(e.target.value) : null;
            onChangeOrigin(id);
            if (destinationId !== null && destinationId === id) {
              onChangeDestination(null);
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
    </>
  );
}
