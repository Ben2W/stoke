import { getCollection, type CollectionEntry } from "astro:content";
import docsConfig from "../../docs.json";

export type DocsEntry = CollectionEntry<"docs">;

type RawNavigationPage =
  | string
  | {
    group?: string;
    label?: string;
    root?: string;
    pages?: readonly RawNavigationPage[];
  };

type DocsNavigationFolder = {
  label: string;
  entries: readonly DocsNavigationItem[];
};

type DocsNavigationItem = string | DocsNavigationFolder;

type ResolvedDocsNavigationFolder = {
  label: string;
  entries: DocsEntry[];
};

export type ResolvedDocsNavigationItem = DocsEntry | ResolvedDocsNavigationFolder;

const rawNavigation = ((docsConfig as {
  navigation?: {
    pages?: readonly RawNavigationPage[];
    groups?: readonly RawNavigationPage[];
  };
}).navigation?.pages ?? (docsConfig as {
  navigation?: {
    groups?: readonly RawNavigationPage[];
  };
}).navigation?.groups ?? []) as readonly RawNavigationPage[];

function normalizeNavigationPage(page: string) {
  const normalized = page.replace(/^\/+/, "");
  return normalized === "introduction" ? "index" : normalized;
}

function navigationItemsFor(pages: readonly RawNavigationPage[] = []): DocsNavigationItem[] {
  return pages.flatMap((page): DocsNavigationItem[] => {
    if (typeof page === "string") return [normalizeNavigationPage(page)];

    const entries = navigationItemsFor(page.pages ?? []);
    const root = page.root ? [normalizeNavigationPage(page.root)] : [];
    const allEntries = [...root, ...entries];
    if (!allEntries.length) return [];

    return [{
      label: page.group ?? page.label ?? "Docs",
      entries: allEntries,
    }];
  });
}

export const DOCS_NAVIGATION = navigationItemsFor(rawNavigation);

function flattenNavigationItems(items: readonly DocsNavigationItem[]) {
  return items.flatMap((item): string[] =>
    typeof item === "string" ? [item] : flattenNavigationItems(item.entries),
  );
}

const navigationIds = flattenNavigationItems(DOCS_NAVIGATION);
const navigationIdSet = new Set(navigationIds);
const navOrder: Map<string, number> = new Map(
  navigationIds.map((id, index) => [id, index]),
);

export function normalizeDocPath(pathname: string) {
  if (!pathname || pathname === "/") return "/";
  const withoutQuery = pathname.split(/[?#]/, 1)[0] ?? pathname;
  const trimmed = withoutQuery.replace(/\/+$/, "");
  return trimmed ? `/${trimmed.replace(/^\/+/, "")}` : "/";
}

export function docPathFromId(id: string) {
  if (id === "index") return "/";
  return `/${id.replace(/\/index$/, "")}`;
}

export function docOgImagePathFromId(id: string) {
  const path = docPathFromId(id);
  return `/og/${path === "/" ? "index" : path.slice(1)}.png`;
}

export function slugParamFromDoc(entry: DocsEntry) {
  const path = docPathFromId(entry.id);
  return path === "/" ? undefined : path.slice(1);
}

export function docIdFromSlug(slug?: string) {
  if (!slug) return "index";
  const normalized = slug.replace(/^\/+|\/+$/g, "");
  if (!normalized) return "index";
  return normalized;
}

export function docDisplayTitle(entry: DocsEntry) {
  return entry.data.sidebarTitle ?? entry.data.title;
}

export async function getDocsEntries() {
  const entries = await getCollection("docs");
  const visibleEntries = navigationIdSet.size
    ? entries.filter((entry) => navigationIdSet.has(entry.id))
    : entries;

  return visibleEntries.sort((a, b) => {
    const aOrder = navOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const bOrder = navOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return a.id.localeCompare(b.id);
  });
}

export async function getDocsEntryBySlug(slug?: string) {
  const entries = await getDocsEntries();
  const id = docIdFromSlug(slug);
  return (
    entries.find((entry) => entry.id === id) ??
    entries.find((entry) => entry.id === `${id}/index`)
  );
}

function resolveNavigationItems(
  items: readonly DocsNavigationItem[],
  byId: Map<string, DocsEntry>,
): ResolvedDocsNavigationItem[] {
  return items.flatMap((item): ResolvedDocsNavigationItem[] => {
    if (typeof item === "string") {
      const entry = byId.get(item);
      return entry ? [entry] : [];
    }

    const folderEntries = flattenNavigationItems(item.entries)
      .map((id): DocsEntry | undefined => byId.get(id))
      .filter((entry): entry is DocsEntry => Boolean(entry));

    if (!folderEntries.length) return [];

    return [{
      label: item.label,
      entries: folderEntries,
    }];
  });
}

export function getNavigationGroups(entries: DocsEntry[]) {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const groups: Array<{ label: string; entries: ResolvedDocsNavigationItem[] }> = [];
  let looseEntries: DocsNavigationItem[] = [];

  const flushLooseEntries = () => {
    if (!looseEntries.length) return;
    const resolved = resolveNavigationItems(looseEntries, byId);
    if (resolved.length) groups.push({ label: "Start", entries: resolved });
    looseEntries = [];
  };

  for (const item of DOCS_NAVIGATION) {
    if (typeof item === "string") {
      looseEntries.push(item);
      continue;
    }

    flushLooseEntries();
    const resolved = resolveNavigationItems(item.entries, byId);
    if (resolved.length) groups.push({ label: item.label, entries: resolved });
  }

  flushLooseEntries();

  return groups;
}

export function getAdjacentDocs(entries: DocsEntry[], current: DocsEntry) {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const scopedEntries = flattenNavigationItems(DOCS_NAVIGATION)
    .map((id) => byId.get(id))
    .filter((entry): entry is DocsEntry => Boolean(entry));
  const candidates = scopedEntries.length ? scopedEntries : entries;
  const index = candidates.findIndex((entry) => entry.id === current.id);
  return {
    previous: index > 0 ? candidates[index - 1] : undefined,
    next: index >= 0 && index < candidates.length - 1 ? candidates[index + 1] : undefined,
  };
}
