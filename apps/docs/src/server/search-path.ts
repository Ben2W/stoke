import { docsWebPath } from "../lib/docs-paths";

export const SEARCH_PATH = docsWebPath("/api/search");

export function isSearchRequest(url: URL) {
  return url.pathname === SEARCH_PATH;
}
