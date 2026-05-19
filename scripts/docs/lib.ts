import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { extname, join, relative, sep } from "node:path";
import { parseVersion, root } from "../release/config";

export const docsDir = join(root, "apps", "docs");
export const docsJsonPath = join(docsDir, "docs.json");
export const latestTag = "Latest";
export const canaryVersion = "Canary";
export const canaryTag = "Preview";
const canaryPathPrefix = "canary";
const legacyLatestVersion = "Latest";
const legacyCanaryVersion = "canary";

type NavigationPage = string | NavigationGroup;

type NavigationGroup = {
  group?: string;
  pages?: NavigationPage[];
  [key: string]: unknown;
};

type NavigationVersion = {
  version: string;
  tag?: string;
  default?: boolean;
  pages?: NavigationPage[];
  groups?: NavigationGroup[];
  [key: string]: unknown;
};

type DocsJson = {
  navigation?: {
    pages?: NavigationPage[];
    groups?: NavigationGroup[];
    versions?: NavigationVersion[];
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
  const version = normalizeDocsVersion(inputVersion);
  const docsJson = readDocsJson();
  const latestPages = latestPagesFor(docsJson);
  const canaryPages = canaryPagesFor(docsJson, latestPages);
  const versionDir = join(docsDir, version);

  if (existsSync(versionDir)) {
    if (!options.force) {
      throw new Error(`${relative(root, versionDir)} already exists. Pass --force to replace it.`);
    }
    rmSync(versionDir, { recursive: true, force: true });
  }

  copyCurrentDocsToVersion(version);
  rewriteVersionedDocLinks(version);
  markDocsNoindex(versionDir);
  ensureCanaryDocs();
  updateDocsJsonForVersion(docsJson, version, latestPages, canaryPages);
  assertDocsReleaseSnapshot(version);

  console.log(`Created docs snapshot ${version}`);
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
  const navigation = docsJson.navigation;
  if (!navigation?.versions || navigation.versions.length === 0) {
    throw new Error("apps/docs/docs.json must use navigation.versions for release docs");
  }

  const currentEntry = navigation.versions.find((entry) => entry.default === true);
  if (!currentEntry) {
    throw new Error("apps/docs/docs.json is missing a default docs version");
  }
  if (currentEntry.version === legacyLatestVersion) {
    throw new Error(`The default docs version must be a semver release, not ${JSON.stringify(legacyLatestVersion)}`);
  }
  if (!isStableDocsVersion(currentEntry.version)) {
    throw new Error(`The default docs version must be a stable release; got ${currentEntry.version}`);
  }
  if (currentEntry.tag !== latestTag) {
    throw new Error(`The default docs version must be tagged ${JSON.stringify(latestTag)}`);
  }
  if (options.requireLatestTag && currentEntry.version !== version) {
    throw new Error(`The default docs version must be ${version}`);
  }

  const versionEntry = navigation.versions.find((entry) => entry.version === version);
  if (!versionEntry) {
    throw new Error(`apps/docs/docs.json is missing docs version ${version}`);
  }

  const versionDir = join(docsDir, version);
  if (!existsSync(versionDir) || !statSync(versionDir).isDirectory()) {
    throw new Error(`Missing docs snapshot directory ${relative(root, versionDir)}`);
  }

  const canaryEntry = navigation.versions.find((entry) => isCanaryVersion(entry.version));
  if (!canaryEntry) {
    throw new Error(`apps/docs/docs.json is missing the ${canaryVersion} docs version`);
  }
  if (canaryEntry.tag !== canaryTag) {
    throw new Error(`The ${canaryVersion} docs version must be tagged ${JSON.stringify(canaryTag)}`);
  }

  for (const entry of navigation.versions) {
    if (entry !== currentEntry && entry.default === true) {
      throw new Error(`Only ${currentEntry.version} may be default; ${entry.version} also has default: true`);
    }
    if (entry !== currentEntry && entry.tag === latestTag) {
      throw new Error(`Only ${currentEntry.version} may be tagged ${JSON.stringify(latestTag)}; ${entry.version} is also tagged`);
    }
  }

  const latestPages = pagesForVersion(currentEntry);
  if (latestPages.length === 0) {
    throw new Error(`${currentEntry.version} docs version has no pages`);
  }
  for (const page of latestPages) {
    if (isVersionedPage(page) || page.startsWith(`${canaryPathPrefix}/`)) {
      throw new Error(`${currentEntry.version} docs page ${page} must use an unversioned canonical path`);
    }
    const path = pagePath(page);
    if (!existsSync(path)) {
      throw new Error(`${currentEntry.version} docs references missing page ${relative(root, path)}`);
    }
  }

  const archivePages = versionEntry.default === true
    ? pagesForNavigationPages(prefixPages(latestPages, version))
    : pagesForVersion(versionEntry);
  if (archivePages.length === 0) {
    throw new Error(`Docs version ${version} has no archived pages`);
  }

  for (const page of archivePages) {
    if (!page.startsWith(`${version}/`)) {
      throw new Error(`Archived docs version ${version} page ${page} must live under ${version}/`);
    }
    const path = pagePath(page);
    if (!existsSync(path)) {
      throw new Error(`Archived docs version ${version} references missing page ${relative(root, path)}`);
    }
    assertFileNoindex(path);
  }

  const canaryPages = pagesForVersion(canaryEntry);
  if (canaryPages.length === 0) {
    throw new Error(`${canaryVersion} docs version has no pages`);
  }
  for (const page of canaryPages) {
    if (!page.startsWith(`${canaryPathPrefix}/`)) {
      throw new Error(`${canaryVersion} docs page ${page} must live under ${canaryPathPrefix}/`);
    }
    const path = pagePath(page);
    if (!existsSync(path)) {
      throw new Error(`${canaryVersion} docs references missing page ${relative(root, path)}`);
    }
    assertFileNoindex(path);
  }
}

function readDocsJson(): DocsJson {
  return JSON.parse(readFileSync(docsJsonPath, "utf8")) as DocsJson;
}

function writeDocsJson(value: DocsJson): void {
  writeFileSync(docsJsonPath, `${JSON.stringify(value, null, 2)}\n`);
}

function latestPagesFor(docsJson: DocsJson): NavigationPage[] {
  const navigation = docsJson.navigation;
  if (!navigation) {
    throw new Error("apps/docs/docs.json is missing navigation");
  }

  if (navigation.versions) {
    const latest = navigation.versions.find((entry) => entry.version === legacyLatestVersion)
      ?? navigation.versions.find((entry) => entry.default === true);
    if (latest) {
      if (latest.pages) return removeLeadingVersionPrefix(latest.pages);
      if (latest.groups) return removeLeadingVersionPrefix(latest.groups);
      throw new Error(`The default docs version must define pages or groups`);
    }

    const legacyCanary = navigation.versions.find((entry) => isCanaryVersion(entry.version));
    if (legacyCanary) {
      const legacyPages = legacyCanary.pages ?? legacyCanary.groups;
      if (legacyPages) return removePagePrefix(legacyPages, canaryPathPrefix);
    }

    const defaultVersion = navigation.versions.find((entry) => entry.default === true);
    const defaultPages = defaultVersion?.pages ?? defaultVersion?.groups;
    if (defaultPages) return removeLeadingVersionPrefix(defaultPages);

    throw new Error(`apps/docs/docs.json navigation.versions must include a default docs version or ${canaryVersion}`);
  }

  if (navigation.pages) return navigation.pages;
  if (navigation.groups) return navigation.groups;
  throw new Error("apps/docs/docs.json navigation must define pages, groups, or versions");
}

function canaryPagesFor(docsJson: DocsJson, latestPages: NavigationPage[]): NavigationPage[] {
  const navigation = docsJson.navigation;
  const canary = navigation?.versions?.find((entry) => isCanaryVersion(entry.version));
  const pages = canary?.pages ?? canary?.groups;
  if (!pages) return prefixPages(latestPages, canaryPathPrefix);

  const flatPages = pagesForNavigationPages(pages);
  if (flatPages.every((page) => page.startsWith(`${canaryPathPrefix}/`))) {
    return pages;
  }

  return prefixPages(removePagePrefix(pages, canaryPathPrefix), canaryPathPrefix);
}

function copyCurrentDocsToVersion(version: string): void {
  const targetDir = join(docsDir, version);
  mkdirSync(targetDir, { recursive: true });

  for (const entry of readdirSync(docsDir, { withFileTypes: true })) {
    if (shouldSkipDocsRootEntry(entry.name, version)) continue;
    cpSync(join(docsDir, entry.name), join(targetDir, entry.name), {
      recursive: true,
      errorOnExist: false,
      force: true,
    });
  }
}

function shouldSkipDocsRootEntry(name: string, currentVersion: string): boolean {
  return (
    name === currentVersion ||
    name === canaryPathPrefix ||
    name === "node_modules" ||
    name === "docs.json" ||
    name === "package.json" ||
    name === "package-lock.json" ||
    name === "pnpm-lock.yaml" ||
    name === "yarn.lock" ||
    name === "bun.lock" ||
    name === ".gitignore" ||
    name === ".DS_Store" ||
    name === ".mintlify" ||
    /^v\d+\.\d+\.\d+$/.test(name)
  );
}

function ensureCanaryDocs(): void {
  const canaryDir = join(docsDir, canaryPathPrefix);
  if (existsSync(canaryDir)) return;

  mkdirSync(canaryDir, { recursive: true });
  for (const entry of readdirSync(docsDir, { withFileTypes: true })) {
    if (shouldSkipDocsRootEntry(entry.name, canaryPathPrefix)) continue;
    cpSync(join(docsDir, entry.name), join(canaryDir, entry.name), {
      recursive: true,
      errorOnExist: false,
      force: true,
    });
  }
  rewriteLinksInDocsDir(canaryDir, canaryPathPrefix);
  markDocsNoindex(canaryDir);
}

function rewriteVersionedDocLinks(version: string): void {
  rewriteLinksInDocsDir(join(docsDir, version), version);
}

function rewriteLinksInDocsDir(dir: string, prefix: string): void {
  for (const file of listFiles(dir)) {
    const extension = extname(file);
    if (extension !== ".mdx" && extension !== ".md") continue;
    const source = readFileSync(file, "utf8");
    const next = rewriteAbsoluteDocLinks(source, prefix);
    if (next !== source) {
      writeFileSync(file, next);
    }
  }
}

function rewriteAbsoluteDocLinks(source: string, prefix: string): string {
  return source
    .replace(
      /(\]\()\/(?!v\d+\.\d+\.\d+\/|canary\/|\/|#|https?:\/\/)([^)\s]*)/g,
      `$1/${prefix}/$2`,
    )
    .replace(
      /(href=["'])\/(?!v\d+\.\d+\.\d+\/|canary\/|\/|#|https?:\/\/)([^"']*)/g,
      `$1/${prefix}/$2`,
    );
}

export function markDocsNoindex(dir: string): void {
  for (const file of listFiles(dir)) {
    const extension = extname(file);
    if (extension !== ".mdx" && extension !== ".md") continue;
    const source = readFileSync(file, "utf8");
    const next = ensureNoindexFrontmatter(source);
    if (next !== source) {
      writeFileSync(file, next);
    }
  }
}

function updateDocsJsonForVersion(
  docsJson: DocsJson,
  version: string,
  latestPages: NavigationPage[],
  canaryPages: NavigationPage[],
): void {
  const navigation = docsJson.navigation ?? {};
  const existingVersions = navigation.versions ?? [];
  const latestEntry = existingVersions.find((entry) => entry.version === legacyLatestVersion)
    ?? existingVersions.find((entry) => entry.default === true);
  const canaryEntry = existingVersions.find((entry) => isCanaryVersion(entry.version));
  const previousStable = existingVersions.filter((entry) =>
    entry.version !== legacyLatestVersion && !isCanaryVersion(entry.version) && entry.version !== version
  );

  const nextLatest: NavigationVersion = {
    ...(latestEntry ?? {}),
    version,
    default: true,
    tag: latestTag,
    pages: latestPages,
  };
  delete nextLatest.groups;

  const nextCanary: NavigationVersion = {
    ...(canaryEntry ?? {}),
    version: canaryVersion,
    tag: canaryTag,
    pages: canaryPages,
  };
  delete nextCanary.default;
  delete nextCanary.groups;

  const nextStableVersions = previousStable.map((entry) => {
    const sourcePages = entry.pages ?? entry.groups;
    const next: NavigationVersion = {
      ...entry,
      pages: sourcePages ? prefixPages(removeLeadingVersionPrefix(sourcePages), entry.version) : entry.pages,
    };
    delete next.default;
    delete next.groups;
    if (next.tag === latestTag || next.tag === version) delete next.tag;
    return next;
  });

  docsJson.navigation = {
    ...navigation,
    versions: [
      nextLatest,
      nextCanary,
      ...nextStableVersions,
    ],
  };
  delete docsJson.navigation.pages;
  delete docsJson.navigation.groups;

  writeDocsJson(docsJson);
}

function prefixPages(pages: NavigationPage[], prefix: string): NavigationPage[] {
  return pages.map((page) => {
    if (typeof page === "string") return prefixPagePath(page, prefix);
    const next: NavigationGroup = { ...page };
    if (typeof next.root === "string") {
      next.root = prefixPagePath(next.root, prefix);
    }
    if (next.pages) {
      next.pages = prefixPages(next.pages, prefix);
    }
    return next;
  });
}

function prefixPagePath(page: string, prefix: string): string {
  if (page.startsWith(`${prefix}/`)) return page;
  if (/^https?:\/\//.test(page) || page.startsWith("/")) return page;
  return `${prefix}/${page}`;
}

function removeLeadingVersionPrefix(pages: NavigationPage[]): NavigationPage[] {
  return pages.map((page) => {
    if (typeof page === "string") return page.replace(/^v\d+\.\d+\.\d+\//, "");
    const next: NavigationGroup = { ...page };
    if (typeof next.root === "string") {
      next.root = next.root.replace(/^v\d+\.\d+\.\d+\//, "");
    }
    if (next.pages) {
      next.pages = removeLeadingVersionPrefix(next.pages);
    }
    return next;
  });
}

function removePagePrefix(pages: NavigationPage[], prefix: string): NavigationPage[] {
  return pages.map((page) => {
    if (typeof page === "string") return removePrefix(page, prefix);
    const next: NavigationGroup = { ...page };
    if (typeof next.root === "string") {
      next.root = removePrefix(next.root, prefix);
    }
    if (next.pages) {
      next.pages = removePagePrefix(next.pages, prefix);
    }
    return next;
  });
}

function removePrefix(page: string, prefix: string): string {
  return page.startsWith(`${prefix}/`) ? page.slice(prefix.length + 1) : page;
}

function pagesForVersion(version: NavigationVersion): string[] {
  const roots: NavigationPage[] = version.pages ?? version.groups ?? [];
  return pagesForNavigationPages(roots);
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
  const normalized = page.split("/").join(sep);
  return join(docsDir, `${normalized}.mdx`);
}

function isCanaryVersion(version: string): boolean {
  return version === canaryVersion || version === legacyCanaryVersion;
}

function isStableDocsVersion(version: string): boolean {
  if (!/^v\d+\.\d+\.\d+$/.test(version)) return false;
  return !version.includes("-");
}

function isVersionedPage(page: string): boolean {
  return /^v\d+\.\d+\.\d+\//.test(page);
}

function ensureNoindexFrontmatter(source: string): string {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    return `---\nnoindex: true\n---\n\n${source}`;
  }

  const frontmatter = match[1];
  if (/^noindex:\s*true\s*$/m.test(frontmatter)) return source;

  const nextFrontmatter = `${frontmatter.trimEnd()}\nnoindex: true`;
  const body = source.slice(match[0].length).replace(/^\r?\n/, "");
  return `---\n${nextFrontmatter}\n---\n\n${body}`;
}

function assertFileNoindex(path: string): void {
  const source = readFileSync(path, "utf8");
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match || !/^noindex:\s*true\s*$/m.test(match[1])) {
    throw new Error(`${relative(root, path)} must set noindex: true`);
  }
}

function listFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(path));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}
