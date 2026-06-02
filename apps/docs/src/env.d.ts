/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />
/// <reference types="@astrojs/cloudflare" />

interface Env {
  ASSETS: Fetcher;
  /**
   * Cache-busting namespace for the Worker cache, stamped per deploy from the
   * commit SHA (see `scripts/cache-version.ts` and the deploy scripts).
   */
  CACHE_VERSION?: string;
  /**
   * Local development only. When set, the Worker proxies static/docs assets to
   * an Astro dev server while still handling Worker routes.
   */
  DEV_ASSET_ORIGIN?: string;
  /**
   * Local development only. Wrangler strips the port from request URLs, so the
   * dev launcher passes the Worker origin for copyable help examples.
   */
  DEV_WORKER_ORIGIN?: string;
}
