import { handleInstallRequest, isInstallPath, type InstallEnv } from "./worker/install.ts";
import {
  docsHostRedirect,
  handleDocsRequest,
  type DocsRouterEnv,
} from "./worker/docs-router.ts";

const PRIMARY_HOST = "www.rigkit.dev";
const REDIRECT_HOSTS = new Set(["rigkit.dev", "rig.freestyle.sh", "rigkit.freestyle.sh"]);

interface Env extends InstallEnv, DocsRouterEnv {
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

function assetRequest(request: Request, url: URL, pathname: string): Request {
  const assetUrl = new URL(url);
  assetUrl.pathname = pathname;
  return new Request(assetUrl, request);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    const docsHost = docsHostRedirect(url);
    if (docsHost) return docsHost;

    if (REDIRECT_HOSTS.has(url.hostname)) {
      return redirectToPrimaryHost(url);
    }

    if (url.protocol === "http:") {
      return redirectToHttps(url);
    }

    if (isInstallPath(url.pathname)) {
      return handleInstallRequest(request, env, ctx);
    }

    const docsResponse = await handleDocsRequest(request, env);
    if (docsResponse) return docsResponse;

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
