import { handleInstallRequest, isInstallPath, type InstallEnv } from "./worker/install.ts";

const PRIMARY_HOST = "www.rigkit.dev";
const DOCS_HOST = "docs.rigkit.dev";
const REDIRECT_HOSTS = new Set(["rigkit.dev", "rig.freestyle.sh", "rigkit.freestyle.sh"]);
const MINTLIFY_HOST = "freestyle.mintlify.dev";
const DOCS_CUSTOM_HOST = DOCS_HOST;

interface Env extends InstallEnv {
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
}

function redirectToHttps(url: URL): Response {
  url.protocol = "https:";
  return Response.redirect(url.toString(), 308);
}

function redirectToPrimaryHost(url: URL): Response {
  const target = new URL(url.toString());
  target.protocol = "https:";
  target.hostname = PRIMARY_HOST;
  target.port = "";
  return Response.redirect(target.toString(), 308);
}

function redirectToDocsHost(url: URL): Response {
  const target = new URL(url.toString());
  target.protocol = "https:";
  target.hostname = DOCS_HOST;
  target.port = "";
  target.pathname = docsCanonicalPath(url.pathname);
  return Response.redirect(target.toString(), 308);
}

function redirectDocsHostPath(url: URL): Response {
  const target = new URL(url.toString());
  target.protocol = "https:";
  target.port = "";
  target.pathname = docsCanonicalPath(url.pathname);
  return Response.redirect(target.toString(), 308);
}

function docsCanonicalPath(pathname: string): string {
  if (pathname === "/docs") return "/";
  if (pathname.startsWith("/docs/")) return pathname.slice("/docs".length);
  return pathname || "/";
}

function mintlifyDocsPath(pathname: string): string {
  if (pathname === "/" || pathname === "") return "/docs";
  return `/docs${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}

function assetRequest(request: Request, url: URL, pathname: string): Request {
  const assetUrl = new URL(url);
  assetUrl.pathname = pathname;
  return new Request(assetUrl, request);
}

function isDocsPath(pathname: string): boolean {
  return pathname === "/docs" || pathname.startsWith("/docs/");
}

function proxyDocsToMintlify(request: Request, url: URL): Promise<Response> {
  const upstream = new URL(url.toString());
  upstream.hostname = MINTLIFY_HOST;
  upstream.protocol = "https:";
  upstream.port = "";
  upstream.pathname = mintlifyDocsPath(url.pathname);

  const proxyRequest = new Request(upstream, request);
  proxyRequest.headers.set("Host", MINTLIFY_HOST);
  proxyRequest.headers.set("X-Forwarded-Host", DOCS_CUSTOM_HOST);
  proxyRequest.headers.set("X-Forwarded-Proto", "https");

  return fetch(proxyRequest);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.hostname === DOCS_HOST) {
      if (isDocsPath(url.pathname)) return redirectDocsHostPath(url);
      if (url.protocol === "http:") return redirectToHttps(url);
      return proxyDocsToMintlify(request, url);
    }

    if (isDocsPath(url.pathname)) {
      return redirectToDocsHost(url);
    }

    if (REDIRECT_HOSTS.has(url.hostname)) {
      return redirectToPrimaryHost(url);
    }

    if (url.protocol === "http:") {
      return redirectToHttps(url);
    }

    if (isInstallPath(url.pathname)) {
      return handleInstallRequest(request, env, ctx);
    }

    if (url.pathname === "/") {
      return env.ASSETS.fetch(assetRequest(request, url, "/index.html"));
    }

    if (url.pathname === "/releases") {
      return env.ASSETS.fetch(assetRequest(request, url, "/releases.html"));
    }

    if (url.pathname.startsWith("/releases/")) {
      return env.ASSETS.fetch(assetRequest(request, url, "/release.html"));
    }

    if (url.pathname === "/canary") {
      return env.ASSETS.fetch(assetRequest(request, url, "/canary.html"));
    }

    return env.ASSETS.fetch(request);
  },
};
