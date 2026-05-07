export type DurationInput = number | string;

const units: Record<string, number> = {
  ms: 1,
  millisecond: 1,
  milliseconds: 1,
  s: 1000,
  sec: 1000,
  secs: 1000,
  second: 1000,
  seconds: 1000,
  m: 60 * 1000,
  min: 60 * 1000,
  mins: 60 * 1000,
  minute: 60 * 1000,
  minutes: 60 * 1000,
  h: 60 * 60 * 1000,
  hr: 60 * 60 * 1000,
  hrs: 60 * 60 * 1000,
  hour: 60 * 60 * 1000,
  hours: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  days: 24 * 60 * 60 * 1000,
};

export function parseDurationMs(value: DurationInput): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) throw new Error(`Duration must be a non-negative number`);
    return Math.floor(value);
  }

  const trimmed = value.trim().toLowerCase();
  const match = /^(\d+(?:\.\d+)?)\s*([a-z]+)$/.exec(trimmed);
  if (!match) {
    throw new Error(`Invalid duration ${JSON.stringify(value)}. Use values like "30m", "6h", or "1day".`);
  }

  const amount = Number(match[1]);
  const unit = units[match[2]!];
  if (!unit) {
    throw new Error(`Invalid duration unit ${JSON.stringify(match[2])}`);
  }

  return Math.floor(amount * unit);
}
