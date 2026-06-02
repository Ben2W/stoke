export { docsWebPath as docsPath } from "./lib/docs-paths";
export {
  cacheControlFor,
  cloudflareCacheControlFor,
  shouldReadWorkerCache,
  shouldWriteWorkerCache,
  withCacheHeaders,
  withHeadBodyPolicy,
  workerCacheKey,
} from "./server/cache";
export {
  canonicalDocsPathRedirect,
  legacyDocsHostRedirect,
  legacyLookupPathname,
  redirectResponse,
} from "./server/routing";
export { isBashRequest } from "./server/bash-route";
export { isSearchRequest } from "./server/search-path";
