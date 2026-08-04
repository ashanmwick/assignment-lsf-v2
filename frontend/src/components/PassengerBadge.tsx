import type { Passenger } from "../api";

interface Props {
  passenger: Passenger;
  onChange: () => void;
}

export function PassengerBadge({ passenger, onChange }: Props) {
  return (
    <div className="panel passenger-panel">
      <div>
        Booking as <strong>{passenger.name}</strong>
      </div>
      <button className="link-button" onClick={onChange}>
        change
      </button>
    </div>
  );
}
