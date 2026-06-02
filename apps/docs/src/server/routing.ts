import { DOCS_WEB_BASE_PATH, docsWebPath } from "../lib/docs-paths";
import { getLegacyRedirect } from "../lib/legacy-redirects";

const LEGACY_DOCS_HOST = "docs.rigkit.dev";
const APEX_DOCS_HOST = "rigkit.dev";
const CANONICAL_DOCS_ORIGIN = "https://www.rigkit.dev";

function permanentRedirect(location: string) {
  return new Response(null, {
    status: 308,
    headers: {
      Location: location,
      "Cache-Control": "public, max-age=60, s-maxage=300",
      "Cloudflare-CDN-Cache-Control": "public, max-age=300",
      "Cache-Tag": "freestyle-docs",
    },
  });
}

export function isLocalHostHeader(host: string) {
  return host.startsWith("localhost:") || host.startsWith("127.0.0.1:");
}

export function redirectResponse(url: URL, destination: string) {
  const target = new URL(destination, url);
  return permanentRedirect(target.toString());
}

export function legacyLookupPathname(pathname: string) {
  if (pathname === DOCS_WEB_BASE_PATH) return "/";
  if (pathname.startsWith(`${DOCS_WEB_BASE_PATH}/`)) {
    return pathname.slice(DOCS_WEB_BASE_PATH.length) || "/";
  }
  return pathname;
}

export function legacyDocsHostRedirect(url: URL) {
  if (url.hostname === APEX_DOCS_HOST && url.port) return undefined;

  if (url.hostname !== LEGACY_DOCS_HOST && url.hostname !== APEX_DOCS_HOST) {
    return undefined;
  }

  const sourcePathname = legacyLookupPathname(url.pathname);
  const destinationPath = getLegacyRedirect(sourcePathname) ?? sourcePathname;
  const target = new URL(CANONICAL_DOCS_ORIGIN);
  target.pathname = docsWebPath(destinationPath);
  target.search = url.search;
  return redirectResponse(url, target.toString());
}

export function legacyPathRedirect(url: URL) {
  const legacyRedirect = getLegacyRedirect(legacyLookupPathname(url.pathname));
  return legacyRedirect ? redirectResponse(url, docsWebPath(legacyRedirect)) : undefined;
}

export function canonicalDocsPathRedirect(url: URL) {
  if (
    url.pathname !== DOCS_WEB_BASE_PATH &&
    !url.pathname.startsWith(`${DOCS_WEB_BASE_PATH}/`)
  ) {
    return undefined;
  }

  const target = new URL(url);

  if (target.pathname.endsWith("/index.html")) {
    target.pathname = target.pathname.slice(0, -"/index.html".length) || "/";
    return permanentRedirect(`${target.pathname}${target.search}`);
  }

  if (target.pathname !== DOCS_WEB_BASE_PATH && target.pathname.endsWith("/")) {
    target.pathname = target.pathname.slice(0, -1);
    return permanentRedirect(`${target.pathname}${target.search}`);
  }

  return undefined;
}
