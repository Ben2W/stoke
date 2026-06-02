import { Hono } from "hono";

import {
  DEFAULT_CACHE_VERSION,
  defaultCache,
  shouldReadWorkerCache,
  shouldWriteWorkerCache,
  withCacheHeaders,
  withHeadBodyPolicy,
  workerCacheKey,
} from "./server/cache";
import { devAssetOrigin, fetchAssetRequest } from "./server/dev-assets";
import {
  canonicalDocsPathRedirect,
  isLocalHostHeader,
  legacyDocsHostRedirect,
  legacyPathRedirect,
} from "./server/routing";
import { docsBashResponse, isBashRequest } from "./server/bash-route";
import { docsSearchResponse, isSearchRequest } from "./server/search-route";

const app = new Hono<{ Bindings: Env }>();

app.use("*", async (context) => {
  const request = context.req.raw;
  const url = new URL(request.url);
  const host = request.headers.get("host") ?? "";

  if (url.pathname === "/docs/wrangler.json") {
    return withHeadBodyPolicy(
      request,
      withCacheHeaders(url, new Response("Not found\n", { status: 404 }), "MISS"),
    );
  }

  const legacyHostRedirect = isLocalHostHeader(host) ? undefined : legacyDocsHostRedirect(url);
  if (legacyHostRedirect) return legacyHostRedirect;

  const redirect =
    legacyPathRedirect(url) ?? canonicalDocsPathRedirect(url);
  if (redirect) return redirect;

  if (isSearchRequest(url)) {
    return withHeadBodyPolicy(request, await docsSearchResponse(request, context.env, url));
  }

  if (isBashRequest(url)) {
    return withHeadBodyPolicy(request, await docsBashResponse(request, context.env, url));
  }

  if (devAssetOrigin(context.env)) {
    return withHeadBodyPolicy(request, await fetchAssetRequest(request, context.env, url));
  }

  const cacheKey = workerCacheKey(
    url,
    context.env.CACHE_VERSION ?? DEFAULT_CACHE_VERSION,
  );

  if (shouldReadWorkerCache(request)) {
    const cached = await defaultCache().match(cacheKey);
    if (cached) {
      return withHeadBodyPolicy(request, withCacheHeaders(url, cached, "HIT"));
    }
  }

  const response = await fetchAssetRequest(request, context.env, url);
  const cachedResponse = withCacheHeaders(url, response, "MISS");
  if (shouldWriteWorkerCache(request, cachedResponse)) {
    context.executionCtx.waitUntil(defaultCache().put(cacheKey, cachedResponse.clone()));
  }

  return withHeadBodyPolicy(request, cachedResponse);
});

export default app;
