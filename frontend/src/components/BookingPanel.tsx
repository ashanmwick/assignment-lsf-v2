import { useEffect, useState } from "react";
import type { Booking } from "../api";

interface Props {
  booking: Booking;
  originName: string;
  destinationName: string;
  seatNumber: string;
  onConfirm: () => Promise<void>;
  onCancel: () => Promise<void>;
  onExpired: () => void;
  onBookAnother: () => void;
}

export function BookingPanel({
  booking,
  originName,
  destinationName,
  seatNumber,
  onConfirm,
  onCancel,
  onExpired,
  onBookAnother,
}: Props) {
  const [remainingMs, setRemainingMs] = useState<number>(msRemaining(booking.heldUntil));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (booking.status !== "held") return;
    const interval = setInterval(() => {
      const ms = msRemaining(booking.heldUntil);
      setRemainingMs(ms);
      if (ms <= 0) {
        clearInterval(interval);
        onExpired();
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [booking.heldUntil, booking.status, onExpired]);

  const handleConfirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to confirm booking");
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async () => {
    setBusy(true);
    setError(null);
    try {
      await onCancel();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to cancel booking");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`panel booking-panel booking-${booking.status}`}>
      <h3>{booking.status === "confirmed" ? "Booking confirmed" : "Seat held"}</h3>
      <dl>
        <dt>Seat</dt>
        <dd>{seatNumber}</dd>
        <dt>Leg</dt>
        <dd>
          {originName} &rarr; {destinationName}
        </dd>
        <dt>Fare</dt>
        <dd>Rs. {booking.fare.toFixed(2)}</dd>
      </dl>

      {booking.status === "held" && (
        <>
          <p className="countdown">Hold expires in {formatCountdown(remainingMs)}</p>
          <div className="booking-actions">
            <button onClick={handleConfirm} disabled={busy}>
              Confirm booking
            </button>
            <button className="secondary" onClick={handleCancel} disabled={busy}>
              Release seat
            </button>
          </div>
        </>
      )}

      {booking.status === "confirmed" && (
        <div className="booking-actions">
          <button onClick={onBookAnother} disabled={busy}>
            Book another seat
          </button>
          <button className="secondary" onClick={handleCancel} disabled={busy}>
            Cancel booking
          </button>
        </div>
      )}

      {error && <p className="error-text">{error}</p>}
    </div>
  );
}

function msRemaining(heldUntil: string | null): number {
  if (!heldUntil) return 0;
  return new Date(heldUntil).getTime() - Date.now();
}

function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
