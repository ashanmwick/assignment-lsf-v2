// Scheduled times are absolute instants (TIMESTAMPTZ), but this is a
// timetable for a specific real-world line — always show it in Sri Lanka
// local time, the same way a real station departure board would, regardless
// of which timezone the viewer's browser happens to be in.
const SCHEDULE_TIME_ZONE = "Asia/Colombo";

export function formatScheduledTime(iso: string | null): string {
  if (!iso) return "--:--";
  return new Date(iso).toLocaleTimeString("en-GB", {
    timeZone: SCHEDULE_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatOffsetDuration(minutes: number): string {
  if (minutes <= 0) return "+0m";
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `+${mins}m`;
  if (mins === 0) return `+${hours}h`;
  return `+${hours}h${mins}m`;
}

/** Journey duration between two scheduled instants, e.g. "2h 49m". */
export function formatDurationBetween(fromIso: string | null, toIso: string | null): string {
  if (!fromIso || !toIso) return "--";
  const minutes = Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 60000);
  if (minutes <= 0) return "0m";
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}
