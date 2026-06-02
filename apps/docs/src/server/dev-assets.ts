export function devAssetOrigin(env: Env) {
  const origin = env.DEV_ASSET_ORIGIN?.trim();
  return origin ? origin.replace(/\/+$/, "") : undefined;
}

function withDevAssetHeaders(response: Response) {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("Cloudflare-CDN-Cache-Control", "no-store");
  headers.set("X-Freestyle-Docs-Cache", "BYPASS");
  headers.set("X-Freestyle-Docs-Dev-Assets", "1");
  headers.delete("Age");
  headers.delete("CF-Cache-Status");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function assetUrlFor(env: Env, url: URL) {
  const origin = devAssetOrigin(env);
  if (!origin) return url;
  return new URL(`${url.pathname}${url.search}`, origin);
}

export async function fetchAssetUrl(env: Env, url: URL) {
  const assetUrl = assetUrlFor(env, url);
  if (!devAssetOrigin(env)) return env.ASSETS.fetch(assetUrl.toString());
  return withDevAssetHeaders(await fetch(assetUrl.toString(), { cache: "no-store" }));
}

export async function fetchAssetRequest(request: Request, env: Env, url: URL) {
  const origin = devAssetOrigin(env);
  if (!origin) return env.ASSETS.fetch(request);

  const assetUrl = assetUrlFor(env, url);
  return withDevAssetHeaders(
    await fetch(
      new Request(assetUrl.toString(), {
        body: request.body,
        headers: request.headers,
        method: request.method,
        redirect: request.redirect,
      }),
      { cache: "no-store" },
    ),
  );
}
