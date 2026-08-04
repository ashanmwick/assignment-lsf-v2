import { useState } from "react";
import type { Passenger } from "../api";
import { api } from "../api";

interface Props {
  passenger: Passenger | null;
  onPassengerCreated: (passenger: Passenger) => void;
  onReset: () => void;
}

export function PassengerForm({ passenger, onPassengerCreated, onReset }: Props) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (passenger) {
    return (
      <div className="panel passenger-panel">
        <div>
          Booking as <strong>{passenger.name}</strong>
        </div>
        <button className="link-button" onClick={onReset}>
          change
        </button>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await api.createPassenger(name.trim(), email.trim() || undefined);
      onPassengerCreated(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create passenger");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="panel passenger-panel" onSubmit={handleSubmit}>
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" required />
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
      <button type="submit" disabled={submitting || !name.trim()}>
        {submitting ? "Saving..." : "Continue"}
      </button>
      {error && <p className="error-text">{error}</p>}
    </form>
  );
}
