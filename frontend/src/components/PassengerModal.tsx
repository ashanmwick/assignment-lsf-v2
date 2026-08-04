import { useState } from "react";
import type { Passenger } from "../api";
import { api } from "../api";

interface Props {
  seatNumber: string;
  onSubmit: (passenger: Passenger) => void;
  onCancel: () => void;
}

type Step = "details" | "otp";

function generateDemoOtp(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

// Asked at the moment a seat is picked -- the earliest point a passenger_id
// is actually required (booking.passenger_id is NOT NULL at hold-creation
// time) -- rather than upfront when the page loads. A dummy OTP step sits
// in front of it to mimic a real mobile-verification flow for the demo; no
// SMS is actually sent, the code is generated and shown client-side.
export function PassengerModal({ seatNumber, onSubmit, onCancel }: Props) {
  const [step, setStep] = useState<Step>("details");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [demoOtp, setDemoOtp] = useState("");
  const [otpInput, setOtpInput] = useState("");
  const [otpError, setOtpError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDetailsSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || phone.trim().length < 9) return;
    setDemoOtp(generateDemoOtp());
    setOtpInput("");
    setOtpError(null);
    setStep("otp");
  };

  const handleOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (otpInput.trim() !== demoOtp) {
      setOtpError("Incorrect code. Check the demo code above and try again.");
      return;
    }
    setOtpError(null);
    setSubmitting(true);
    setError(null);
    try {
      const created = await api.createPassenger(name.trim(), phone.trim());
      onSubmit(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save passenger details");
      setSubmitting(false);
    }
  };

  if (step === "otp") {
    return (
      <div className="modal-backdrop">
        <form className="modal-panel" onSubmit={handleOtpSubmit}>
          <h3>Verify your mobile number</h3>
          <p className="modal-hint">Enter the code sent to {phone}.</p>
          <p className="demo-otp-hint">
            Demo mode — no SMS is sent. Your code is <strong>{demoOtp}</strong>.
          </p>
          <label>
            OTP code
            <input
              value={otpInput}
              onChange={(e) => setOtpInput(e.target.value)}
              placeholder="4-digit code"
              inputMode="numeric"
              maxLength={4}
              autoFocus
              required
            />
          </label>
          <div className="modal-actions">
            <button type="submit" disabled={submitting || otpInput.trim().length === 0}>
              {submitting ? "Booking..." : "Verify & book"}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => setStep("details")}
              disabled={submitting}
            >
              Back
            </button>
          </div>
          {otpError && <p className="error-text">{otpError}</p>}
          {error && <p className="error-text">{error}</p>}
        </form>
      </div>
    );
  }

  return (
    <div className="modal-backdrop">
      <form className="modal-panel" onSubmit={handleDetailsSubmit}>
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
          Mobile number
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="0XXXXXXXXX"
            required
          />
        </label>
        <div className="modal-actions">
          <button type="submit" disabled={!name.trim() || phone.trim().length < 9}>
            Send OTP
          </button>
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
