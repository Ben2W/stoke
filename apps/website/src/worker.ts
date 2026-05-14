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

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.protocol === "http:") {
      return redirectToHttps(url);
    }

    if (isInstallPath(url.pathname)) {
      return handleInstallRequest(request, env, ctx);
    }

    return env.ASSETS.fetch(request);
  },
};
