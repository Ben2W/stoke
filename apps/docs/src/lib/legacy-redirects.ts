export const LEGACY_REDIRECTS = new Map<string, string>([
  ["/introduction", "/"],
]);

export function getLegacyRedirect(pathname: string) {
  const clean = pathname === "/" ? "/" : pathname.replace(/\/+$/, "");
  const markdownRequest = clean.endsWith(".md");
  const lookup = markdownRequest ? clean.slice(0, -3) : clean;
  const destination = LEGACY_REDIRECTS.get(lookup);

  if (!destination) return undefined;
  if (!markdownRequest) return destination;
  if (destination === "/") return "/index.md";
  return `${destination}.md`;
}
