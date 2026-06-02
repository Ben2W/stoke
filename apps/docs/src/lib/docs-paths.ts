export const DOCS_WEB_BASE_PATH =
  (import.meta.env.PUBLIC_DOCS_BASE_PATH || "/docs").replace(/\/+$/, "") || "/docs";

export function docsWebPath(pathname: string) {
  if (pathname === "/" || pathname === "") return DOCS_WEB_BASE_PATH;

  const absolutePath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  if (
    absolutePath === DOCS_WEB_BASE_PATH ||
    absolutePath.startsWith(`${DOCS_WEB_BASE_PATH}/`)
  ) {
    return absolutePath;
  }

  return `${DOCS_WEB_BASE_PATH}${absolutePath}`;
}
