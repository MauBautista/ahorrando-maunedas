// Rule 2: times are epoch ms UTC and the household's local time is Mexico City's.

const localTime = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Mexico_City',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** How far Mexico City's clock is from UTC at [utcMs], in ms (negative: it is behind). */
function offsetAt(utcMs: number): number {
  const parts = Object.fromEntries(localTime.formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]));
  const local = Date.UTC(
    +parts.year!,
    +parts.month! - 1,
    +parts.day!,
    +parts.hour!,
    +parts.minute!,
    +parts.second!,
  );
  return local - utcMs;
}

/**
 * The instant a Mexico City clock shows [year]-[month]-[day] [hour]:[minute]:[second] (month 1–12). Before 2022 the
 * city kept summer time, so the offset is looked up for that date, twice to land on the right side of a change.
 */
export function mexicoCityMs(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): number {
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const first = asUtc - offsetAt(asUtc);
  return asUtc - offsetAt(first);
}
