export const BROWSER_OPEN_CAPABILITY_ID = "browser.open";
export const BROWSER_OPEN_CAPABILITY_SCHEMA_HASH =
  "sha256:c9e09948487f86df64a6a73e1507d3c0577a1062461a878a81dc19e444b36b66";

export const BROWSER_OPEN_CAPABILITY = {
  id: BROWSER_OPEN_CAPABILITY_ID,
  schemaHash: BROWSER_OPEN_CAPABILITY_SCHEMA_HASH,
} as const;

export type BrowserOpenInput = { url: string; displayName: string };

export function parseBrowserOpenInput(value: unknown): BrowserOpenInput {
  if (
    !isRecord(value)
    || typeof value.url !== "string"
    || typeof value.displayName !== "string"
    || !value.displayName.trim()
  ) {
    throw new Error("browser.open requires a URL and displayName");
  }
  const url = new URL(value.url);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("browser.open only supports HTTP and HTTPS URLs");
  }
  return { url: url.toString(), displayName: value.displayName.trim().slice(0, 100) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
