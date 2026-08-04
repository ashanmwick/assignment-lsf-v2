import { useEffect, useState } from "react";
import type { Booking } from "../api";
import { formatScheduledTime } from "../time";

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
  const [paying, setPaying] = useState(false);
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

  // Demo-only "payment": no real gateway involved. Simulates a brief
  // processing delay so the pay-now step feels real before the booking
  // actually flips from held to confirmed.
  const handlePayNow = async () => {
    setBusy(true);
    setPaying(true);
    setError(null);
    try {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await onConfirm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Payment failed — please try again");
    } finally {
      setBusy(false);
      setPaying(false);
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
    <div className={`booking-summary booking-${booking.status}`}>
      <div className="booking-summary-details">
        <div className="booking-summary-item">
          <span className="booking-summary-label">Seat</span>
          <span className="booking-summary-value">{seatNumber}</span>
        </div>
        <div className="booking-summary-item">
          <span className="booking-summary-label">Leg</span>
          <span className="booking-summary-value">
            {originName} &rarr; {destinationName}
          </span>
        </div>
        <div className="booking-summary-item">
          <span className="booking-summary-label">Departs / Arrives</span>
          <span className="booking-summary-value">
            {formatScheduledTime(booking.originScheduledDeparture)} &rarr;{" "}
            {formatScheduledTime(booking.destinationScheduledArrival)}
          </span>
        </div>
        <div className="booking-summary-item">
          <span className="booking-summary-label">Fare</span>
          <span className="booking-summary-value booking-summary-fare">Rs. {booking.fare.toFixed(2)}</span>
        </div>
        {booking.status === "held" && (
          <div className="booking-summary-item">
            <span className="booking-summary-label">Hold expires</span>
            <span className="booking-summary-value countdown">{formatCountdown(remainingMs)}</span>
          </div>
        )}
        {booking.status === "confirmed" && <span className="booking-status-badge">Confirmed</span>}
      </div>

      <div className="booking-actions-wrap">
        <div className="booking-actions">
          {booking.status === "held" && (
            <>
              <button className="secondary" onClick={handleCancel} disabled={busy}>
                Release seat
              </button>
              <button onClick={handlePayNow} disabled={busy}>
                {paying ? "Processing payment..." : `Pay Now Rs. ${booking.fare.toFixed(2)}`}
              </button>
            </>
          )}
          {booking.status === "confirmed" && (
            <>
              <button className="secondary" onClick={handleCancel} disabled={busy}>
                Cancel booking
              </button>
              <button onClick={onBookAnother} disabled={busy}>
                Book another seat
              </button>
            </>
          )}
        </div>
        {booking.status === "held" && <p className="demo-note">Demo payment — no real charge is made.</p>}
      </div>

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
