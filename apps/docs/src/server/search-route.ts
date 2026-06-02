import {
  prepareDocsSearchIndex,
  searchDocs,
  type DocsSearchDocument,
  type PreparedDocsSearchDocument,
} from "../lib/docs-search";
import { docsWebPath } from "../lib/docs-paths";
import { devAssetOrigin, fetchAssetUrl } from "./dev-assets";
import { isSearchRequest } from "./search-path";

const SEARCH_CACHE = "public, max-age=60, s-maxage=300";
const SEARCH_EDGE_CACHE = "public, max-age=300";
const SEARCH_INDEX_PATH = docsWebPath("/api/search-index.json");

let searchIndexPromise: Promise<PreparedDocsSearchDocument[]> | undefined;

function jsonResponse(payload: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  const status = init.status ?? 200;
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", status >= 400 ? "no-store" : SEARCH_CACHE);
  headers.set("Cloudflare-CDN-Cache-Control", status >= 400 ? "no-store" : SEARCH_EDGE_CACHE);
  headers.set("Cache-Tag", "freestyle-docs");

  return new Response(JSON.stringify(payload), {
    ...init,
    headers,
  });
}

async function loadSearchIndex(env: Env, requestUrl: URL) {
  const indexUrl = new URL(SEARCH_INDEX_PATH, requestUrl);
  const response = await fetchAssetUrl(env, indexUrl);

  if (!response.ok) {
    throw new Error(`Search index load failed with ${response.status}`);
  }

  const documents = (await response.json()) as DocsSearchDocument[];
  return prepareDocsSearchIndex(documents);
}

async function getSearchIndex(env: Env, requestUrl: URL) {
  if (devAssetOrigin(env)) {
    return loadSearchIndex(env, requestUrl);
  }

  searchIndexPromise ??= loadSearchIndex(env, requestUrl);

  try {
    return await searchIndexPromise;
  } catch (error) {
    searchIndexPromise = undefined;
    throw error;
  }
}

export async function docsSearchResponse(request: Request, env: Env, url: URL) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return jsonResponse(
      { error: "method_not_allowed" },
      {
        status: 405,
        headers: { Allow: "GET, HEAD" },
      },
    );
  }

  const query = url.searchParams.get("q") ?? "";
  const limit = Number(url.searchParams.get("limit") ?? "10");

  if (!query.trim()) {
    return jsonResponse({ query: "", results: [] });
  }

  try {
    const index = await getSearchIndex(env, url);
    return jsonResponse(searchDocs(index, query, { limit: Number.isFinite(limit) ? limit : 10 }));
  } catch (error) {
    return jsonResponse({ error: "search_unavailable" }, { status: 500 });
  }
}

export { isSearchRequest };
