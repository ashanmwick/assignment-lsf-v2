import { useState } from "react";
import type { Passenger } from "../api";
import { api } from "../api";

interface Props {
  seatNumber: string;
  onSubmit: (passenger: Passenger) => void;
  onCancel: () => void;
}

// Asked at the moment a seat is picked -- the earliest point a passenger_id
// is actually required (booking.passenger_id is NOT NULL at hold-creation
// time) -- rather than upfront when the page loads.
export function PassengerModal({ seatNumber, onSubmit, onCancel }: Props) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await api.createPassenger(name.trim(), email.trim() || undefined);
      onSubmit(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save passenger details");
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <form className="modal-panel" onSubmit={handleSubmit}>
        <h3>Who's booking seat {seatNumber}?</h3>
        <label>
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            autoFocus
            required
          />
        </label>
        <label>
          Email (optional)
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </label>
        <div className="modal-actions">
          <button type="submit" disabled={submitting || !name.trim()}>
            {submitting ? "Booking..." : "Continue to book"}
          </button>
          <button type="button" className="secondary" onClick={onCancel} disabled={submitting}>
            Cancel
          </button>
        </div>
        {error && <p className="error-text">{error}</p>}
      </form>
    </div>
  );
}
