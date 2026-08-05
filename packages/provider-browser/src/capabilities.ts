export const BROWSER_OPEN_CAPABILITY_ID = "browser.open";
export const BROWSER_OPEN_CAPABILITY_SCHEMA_HASH =
  "sha256:b9cf7bd1dbb0ae908f606cc819448c8e4f74923d365cb22d7ae8deb7170668b1";

export const BROWSER_OPEN_CAPABILITY = {
  id: BROWSER_OPEN_CAPABILITY_ID,
  schemaHash: BROWSER_OPEN_CAPABILITY_SCHEMA_HASH,
} as const;

export type BrowserOpenInput = { url: string };

export function parseBrowserOpenInput(value: unknown): BrowserOpenInput {
  if (!isRecord(value) || typeof value.url !== "string") {
    throw new Error("browser.open requires a URL");
  }
  const url = new URL(value.url);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("browser.open only supports HTTP and HTTPS URLs");
  }
  return { url: url.toString() };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
