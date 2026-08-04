import { useState } from "react";
import type { AvailabilityCoach, AvailabilitySeat } from "../api";

interface Props {
  reservedCoaches: AvailabilityCoach[];
  unreservedCoaches: AvailabilityCoach[];
  onSelectSeat: (seat: AvailabilitySeat) => void;
  disabled: boolean;
}

export function SeatMap({ reservedCoaches, unreservedCoaches, onSelectSeat, disabled }: Props) {
  const [activeCoachId, setActiveCoachId] = useState<number | null>(reservedCoaches[0]?.coachId ?? null);

  const activeCoach = reservedCoaches.find((c) => c.coachId === activeCoachId) ?? reservedCoaches[0];

  if (reservedCoaches.length === 0) {
    return <div className="panel">No reserved coaches on this trip.</div>;
  }

  return (
    <div className="panel seat-map-panel">
      <div className="coach-tabs">
        {reservedCoaches.map((c) => (
          <button
            key={c.coachId}
            className={c.coachId === activeCoach?.coachId ? "coach-tab active" : "coach-tab"}
            onClick={() => setActiveCoachId(c.coachId)}
          >
            {c.coachNumber}
          </button>
        ))}
      </div>

      <div className="seat-legend">
        <span>
          <i className="swatch available" /> Available
        </span>
        <span>
          <i className="swatch held" /> Held
        </span>
        <span>
          <i className="swatch confirmed" /> Confirmed
        </span>
      </div>

      {activeCoach && (
        <div className="seat-grid" style={{ "--seat-columns": maxColumn(activeCoach.seats) } as React.CSSProperties}>
          {activeCoach.seats.map((seat) => (
            <button
              key={seat.seatId}
              className={`seat seat-${seat.status}`}
              title={`${seat.seatNumber} (${seat.seatType ?? "standard"}) - ${seat.status}`}
              disabled={disabled || seat.status !== "available"}
              onClick={() => onSelectSeat(seat)}
            >
              {seat.seatNumber}
            </button>
          ))}
        </div>
      )}

      {unreservedCoaches.length > 0 && (
        <p className="unreserved-note">
          {unreservedCoaches.length} unreserved coach{unreservedCoaches.length > 1 ? "es" : ""} (
          {unreservedCoaches.map((c) => c.coachNumber).join(", ")}) also run on this trip — first-come,
          first-served, no seat assignment.
        </p>
      )}
    </div>
  );
}

function maxColumn(seats: AvailabilitySeat[]): number {
  return seats.reduce((max, s) => Math.max(max, s.column ?? 1), 1);
}
