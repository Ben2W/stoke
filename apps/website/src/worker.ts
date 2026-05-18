import { handleInstallRequest, isInstallPath, type InstallEnv } from "./worker/install.ts";

interface Env extends InstallEnv {
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
}

function redirectToHttps(url: URL): Response {
  url.protocol = "https:";
  return Response.redirect(url.toString(), 308);
}

function assetRequest(request: Request, url: URL, pathname: string): Request {
  const assetUrl = new URL(url);
  assetUrl.pathname = pathname;
  return new Request(assetUrl, request);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.protocol === "http:") {
      return redirectToHttps(url);
    }

    if (isInstallPath(url.pathname)) {
      return handleInstallRequest(request, env, ctx);
    }

    if (url.pathname === "/docs") {
      return env.ASSETS.fetch(assetRequest(request, url, "/docs.html"));
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
