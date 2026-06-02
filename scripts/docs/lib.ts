import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { parseVersion, root, versionLineForVersion } from "../release/config";

export const docsDir = join(root, "apps", "docs");
export const docsContentDir = join(docsDir, "src", "content", "docs");
export const docsJsonPath = join(docsDir, "docs.json");
const websiteWranglerPath = join(root, "apps", "website", "wrangler.jsonc");
const websiteDocsVersionsPath = join(root, "apps", "website", "src", "worker", "docs-versions.ts");
export const latestTag = "Latest";

type NavigationPage = string | NavigationGroup;

type NavigationGroup = {
  group?: string;
  label?: string;
  root?: string;
  pages?: NavigationPage[];
  [key: string]: unknown;
};

type DocsJson = {
  version?: string;
  tag?: string;
  navigation?: {
    pages?: NavigationPage[];
    groups?: NavigationGroup[];
    versions?: unknown;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export type CreateDocsVersionOptions = {
  force?: boolean;
};

export type AssertDocsVersionOptions = {
  requireLatestTag?: boolean;
};

export function normalizeDocsVersion(input: string): string {
  const normalized = input.trim().replace(/^v/, "");
  parseVersion(normalized);
  if (normalized.includes("-")) {
    throw new Error("Docs versions must be stable semver releases, not prereleases");
  }
  return `v${normalized}`;
}

export function createDocsVersion(inputVersion: string, options: CreateDocsVersionOptions = {}): void {
  void options;
  const version = normalizeDocsVersion(inputVersion);
  const docsJson = readDocsJson();
  const previousVersion = docsJson.version;

  docsJson.version = version;
  docsJson.tag = latestTag;
  delete docsJson.navigation?.versions;

  writeDocsJson(docsJson);
  syncWebsiteDocsRouting(previousVersion, version);
  assertDocsReleaseSnapshot(version);

  console.log(`Updated docs release metadata to ${version}`);
}

export function assertDocsReleaseSnapshot(inputVersion: string): void {
  assertDocsVersion(inputVersion, { requireLatestTag: true });
}

export function assertDocsVersion(
  inputVersion: string,
  options: AssertDocsVersionOptions = {},
): void {
  const version = normalizeDocsVersion(inputVersion);
  const docsJson = readDocsJson();

  if (docsJson.version !== version) {
    throw new Error(`apps/docs/docs.json version must be ${version}; got ${docsJson.version ?? "<missing>"}`);
  }

  if (options.requireLatestTag && docsJson.tag !== latestTag) {
    throw new Error(`apps/docs/docs.json tag must be ${JSON.stringify(latestTag)}`);
  }

  const navigation = docsJson.navigation;
  if (!navigation) {
    throw new Error("apps/docs/docs.json is missing navigation");
  }

  if (navigation.versions) {
    throw new Error("apps/docs/docs.json must not contain navigation.versions; version routing belongs to apps/website");
  }

  const pages = navigation.pages ?? navigation.groups ?? [];
  const flatPages = pagesForNavigationPages(pages);
  if (flatPages.length === 0) {
    throw new Error("apps/docs/docs.json navigation must include pages");
  }

  for (const page of flatPages) {
    if (isVersionedPage(page) || page.startsWith("canary/")) {
      throw new Error(`Docs page ${page} must use an unversioned standalone docs path`);
    }

    const path = pagePath(page);
    if (!existsSync(path)) {
      throw new Error(`Docs references missing page ${relative(root, path)}`);
    }
  }
}

function readDocsJson(): DocsJson {
  return JSON.parse(readFileSync(docsJsonPath, "utf8")) as DocsJson;
}

function writeDocsJson(value: DocsJson): void {
  writeFileSync(docsJsonPath, `${JSON.stringify(value, null, 2)}\n`);
}

function pagesForNavigationPages(roots: NavigationPage[]): string[] {
  const result: string[] = [];
  collectPages(roots, result);
  return result;
}

function collectPages(pages: NavigationPage[], result: string[]): void {
  for (const page of pages) {
    if (typeof page === "string") {
      result.push(page);
      continue;
    }
    if (typeof page.root === "string") result.push(page.root);
    if (page.pages) collectPages(page.pages, result);
  }
}

function pagePath(page: string): string {
  const normalized = (page === "introduction" ? "index" : page).split("/").join(sep);
  return join(docsContentDir, `${normalized}.mdx`);
}

function isVersionedPage(page: string): boolean {
  return /^v\d+\.\d+(?:\.\d+)?\//.test(page);
}

function syncWebsiteDocsRouting(previousVersion: string | undefined, nextVersion: string) {
  if (!existsSync(websiteWranglerPath) || !existsSync(websiteDocsVersionsPath)) return;

  const versionsSource = readFileSync(websiteDocsVersionsPath, "utf8");
  const currentVersions = readDocsVersionsSource(versionsSource);
  const previousLine = previousVersion && isStableDocsVersion(previousVersion)
    ? versionLineForVersion(previousVersion.slice(1))
    : undefined;
  const nextLine = versionLineForVersion(nextVersion.slice(1));

  const versions = currentVersions.filter((entry) => entry.version !== nextVersion);
  const latest = {
    version: nextVersion,
    label: `${nextVersion} · Latest`,
    basePath: "/docs",
    startPath: "/docs",
    binding: "DOCS_LATEST",
    current: true,
  };

  for (const entry of versions) {
    if (entry.current) delete entry.current;
    if (entry.binding === "DOCS_LATEST" || entry.basePath === "/docs") continue;
    entry.archive = true;
  }

  if (previousVersion && previousLine && previousLine !== nextLine) {
    const archiveVersion = `v${previousLine}`;
    const existing = versions.find((entry) => entry.version === archiveVersion);
    const archive = {
      version: archiveVersion,
      label: `${archiveVersion} · ${previousVersion}`,
      basePath: `/docs/${archiveVersion}`,
      startPath: `/docs/${archiveVersion}`,
      binding: bindingNameForLine(archiveVersion),
      archive: true,
    };

    if (existing) Object.assign(existing, archive);
    else versions.push(archive);
  }

  versions.sort((a, b) => {
    if (a.binding === "DOCS_LATEST") return -1;
    if (b.binding === "DOCS_LATEST") return 1;
    return b.version.localeCompare(a.version, undefined, { numeric: true });
  });

  const nextVersions = [latest, ...versions.filter((entry) => entry.binding !== "DOCS_LATEST")];
  const nextVersionsSource = replaceDocsVersionsSource(versionsSource, nextVersions);
  if (nextVersionsSource !== versionsSource) {
    writeFileSync(websiteDocsVersionsPath, nextVersionsSource);
  }

  const wranglerSource = readFileSync(websiteWranglerPath, "utf8");
  const nextServices = syncDocsServices(readServicesArray(wranglerSource), nextVersions);
  const nextWranglerSource = replaceArrayProperty(wranglerSource, "services", nextServices);
  if (nextWranglerSource !== wranglerSource) {
    writeFileSync(websiteWranglerPath, nextWranglerSource);
  }
}

type WebsiteDocsVersion = {
  version: string;
  label?: string;
  basePath: string;
  startPath?: string;
  binding: string;
  current?: boolean;
  archive?: boolean;
};

type WebsiteServiceBinding = {
  binding: string;
  service: string;
};

function readDocsVersionsSource(source: string): WebsiteDocsVersion[] {
  const arraySource = readExportedArray(source, "DOCS_VERSIONS");
  if (!arraySource) return [];

  try {
    const parsed = JSON.parse(arraySource) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isWebsiteDocsVersion);
  } catch {
    return [];
  }
}

function isWebsiteDocsVersion(value: unknown): value is WebsiteDocsVersion {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.version === "string" &&
    typeof candidate.basePath === "string" &&
    typeof candidate.binding === "string"
  );
}

function replaceDocsVersionsSource(source: string, versions: WebsiteDocsVersion[]) {
  const bounds = exportedArrayBounds(source, "DOCS_VERSIONS");
  if (!bounds) return source;

  return `${source.slice(0, bounds.start)}${JSON.stringify(versions, null, 2)}${source.slice(bounds.end + 1)}`;
}

function readServicesArray(source: string): WebsiteServiceBinding[] {
  const arraySource = readArrayProperty(source, "services");
  if (!arraySource) return [];

  try {
    const parsed = JSON.parse(arraySource) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isWebsiteServiceBinding);
  } catch {
    return [];
  }
}

function isWebsiteServiceBinding(value: unknown): value is WebsiteServiceBinding {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.binding === "string" && typeof candidate.service === "string";
}

function syncDocsServices(
  services: WebsiteServiceBinding[],
  versions: WebsiteDocsVersion[],
): WebsiteServiceBinding[] {
  const byBinding = new Map(services.map((service) => [service.binding, service]));
  for (const version of versions) {
    byBinding.set(version.binding, {
      binding: version.binding,
      service: serviceNameForBinding(version.binding),
    });
  }
  return [...byBinding.values()];
}

function serviceNameForBinding(binding: string) {
  if (binding === "DOCS_LATEST") return "rigkit-docs";
  return `rigkit-docs-${binding.replace(/^DOCS_/, "").toLowerCase().replace(/_/g, "-")}`;
}

function bindingNameForLine(archiveVersion: string) {
  return `DOCS_${archiveVersion.replace(/^v/, "V").replace(/\./g, "_")}`;
}

function readArrayProperty(source: string, property: string) {
  const propertyIndex = source.indexOf(`"${property}"`);
  if (propertyIndex < 0) return undefined;
  const start = source.indexOf("[", propertyIndex);
  if (start < 0) return undefined;
  const end = findMatchingBracket(source, start);
  return end ? source.slice(start, end + 1) : undefined;
}

function readExportedArray(source: string, exportName: string) {
  const bounds = exportedArrayBounds(source, exportName);
  return bounds ? source.slice(bounds.start, bounds.end + 1) : undefined;
}

function exportedArrayBounds(source: string, exportName: string) {
  const exportIndex = source.indexOf(`export const ${exportName}`);
  if (exportIndex < 0) return undefined;
  const valueIndex = source.indexOf("=", exportIndex);
  if (valueIndex < 0) return undefined;
  const start = source.indexOf("[", valueIndex);
  if (start < 0) return undefined;
  const end = findMatchingBracket(source, start);
  return end ? { start, end } : undefined;
}

function replaceArrayProperty<T>(source: string, property: string, values: T[]) {
  const propertyIndex = source.indexOf(`"${property}"`);
  if (propertyIndex < 0) {
    const insertion = `  "${property}": ${formatJsonArray(values, 2)},\n`;
    return source.replace(/(\{\n)/, `$1${insertion}`);
  }

  const start = source.indexOf("[", propertyIndex);
  if (start < 0) return source;
  const end = findMatchingBracket(source, start);
  if (!end) return source;

  return `${source.slice(0, start)}${formatJsonArray(values, 2)}${source.slice(end + 1)}`;
}

function findMatchingBracket(source: string, start: number) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "[") depth += 1;
    if (char === "]") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return undefined;
}

function formatJsonArray<T>(values: T[], indent: number) {
  const formatted = JSON.stringify(values, null, 2);
  const padding = " ".repeat(indent);
  return formatted.replace(/\n/g, `\n${padding}`);
}

function isStableDocsVersion(version: string) {
  return /^v\d+\.\d+\.\d+$/.test(version);
}
