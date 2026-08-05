const FINGERPRINT_PREFIX = /^(?:cache:|remote:|workflow:|sha256-)/;

export function shortFingerprint(value: string, length = 8): string {
  return value.replace(FINGERPRINT_PREFIX, "").slice(0, length);
}
