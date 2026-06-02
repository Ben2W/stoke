import { legacyLookupPathname } from "./routing";

export const CACHE_TAG = "freestyle-docs";

const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";
const HTML_CACHE = "public, max-age=60, stale-while-revalidate=300";
const DOCS_CACHE =
  "public, max-age=300, s-maxage=86400, stale-while-revalidate=604800";
const NOT_FOUND_CACHE = "public, max-age=60, s-maxage=300";
const REDIRECT_CACHE = "public, max-age=60, s-maxage=300";
const REDIRECT_EDGE_CACHE = "public, max-age=300";
const HTML_EDGE_CACHE = "public, max-age=300, stale-while-revalidate=60";
const DOCS_EDGE_CACHE =
  "public, max-age=86400, stale-while-revalidate=604800";
const NOT_FOUND_EDGE_CACHE = "public, max-age=300";

// Deploys override this with the commit SHA so every deploy starts a fresh
// Worker cache. Local dev and dry runs use the static fallback.
export const DEFAULT_CACHE_VERSION = "docs-v6";

export function cacheControlFor(url: URL, response: Response) {
  if ([301, 302, 307, 308].includes(response.status)) return REDIRECT_CACHE;
  if (response.status === 404) return NOT_FOUND_CACHE;

  const pathname = legacyLookupPathname(url.pathname);
  const contentType = response.headers.get("content-type") ?? "";

  if (
    pathname.startsWith("/_astro/") ||
    pathname.startsWith("/og/") ||
    pathname === "/favicon.png" ||
    pathname === "/logo.svg" ||
    pathname.endsWith(".css") ||
    pathname.endsWith(".js") ||
    pathname.endsWith(".png") ||
    pathname.endsWith(".svg") ||
    pathname.endsWith(".woff2")
  ) {
    return IMMUTABLE_CACHE;
  }

  if (contentType.includes("text/html")) {
    return HTML_CACHE;
  }

  if (
    pathname.endsWith(".md") ||
    pathname.endsWith(".txt") ||
    pathname.endsWith(".xml") ||
    pathname.endsWith(".json") ||
    pathname === "/just-bash" ||
    pathname === "/docs.sh"
  ) {
    return DOCS_CACHE;
  }

  return response.headers.get("cache-control") ?? DOCS_CACHE;
}

export function cloudflareCacheControlFor(url: URL, response: Response) {
  const browserCache = cacheControlFor(url, response);

  if (browserCache === IMMUTABLE_CACHE) return IMMUTABLE_CACHE;
  if (browserCache === REDIRECT_CACHE) return REDIRECT_EDGE_CACHE;
  if (browserCache === NOT_FOUND_CACHE) return NOT_FOUND_EDGE_CACHE;
  if (browserCache === HTML_CACHE) return HTML_EDGE_CACHE;
  if (browserCache === DOCS_CACHE) return DOCS_EDGE_CACHE;

  return browserCache;
}

export function withCacheHeaders(
  url: URL,
  response: Response,
  cacheStatus: "HIT" | "MISS",
) {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", cacheControlFor(url, response));
  headers.set("Cloudflare-CDN-Cache-Control", cloudflareCacheControlFor(url, response));
  headers.set("Cache-Tag", CACHE_TAG);
  headers.set("X-Freestyle-Docs-Cache", cacheStatus);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function withHeadBodyPolicy(request: Request, response: Response) {
  if (request.method !== "HEAD") return response;
  return new Response(null, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

export function shouldReadWorkerCache(request: Request) {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  const cacheControl = request.headers.get("cache-control")?.toLowerCase() ?? "";
  const pragma = request.headers.get("pragma")?.toLowerCase() ?? "";
  return (
    !cacheControl.includes("no-cache") &&
    !cacheControl.includes("no-store") &&
    !pragma.includes("no-cache")
  );
}

export function shouldWriteWorkerCache(request: Request, response?: Response) {
  if (request.method !== "GET") return false;
  const cacheControl = request.headers.get("cache-control")?.toLowerCase() ?? "";
  if (cacheControl.includes("no-store")) return false;
  if (response && ![200, 404].includes(response.status)) {
    return false;
  }
  return true;
}

export function workerCacheKey(url: URL, version: string) {
  const cacheUrl = new URL(url);
  cacheUrl.searchParams.set("__freestyle_docs_cache", version);
  return new Request(cacheUrl.toString(), { method: "GET" });
}

export function defaultCache() {
  return (caches as CacheStorage & { default: Cache }).default;
}
