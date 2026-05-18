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
export const canaryVersion = "canary";
export const canaryTag = "Canary";
export const latestTag = "Latest";

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
  const canaryPages = canaryPagesFor(docsJson);
  const versionDir = join(docsDir, version);

  if (existsSync(versionDir)) {
    if (!options.force) {
      throw new Error(`${relative(root, versionDir)} already exists. Pass --force to replace it.`);
    }
    rmSync(versionDir, { recursive: true, force: true });
  }

  copyCurrentDocsToVersion(version);
  rewriteVersionedDocLinks(version);
  updateDocsJsonForVersion(docsJson, version, canaryPages);
  assertDocsReleaseSnapshot(version);

  console.log(`Created docs snapshot ${version}`);
}

export function assertDocsReleaseSnapshot(inputVersion: string): void {
  const version = normalizeDocsVersion(inputVersion);
  const docsJson = readDocsJson();
  const navigation = docsJson.navigation;
  if (!navigation?.versions || navigation.versions.length === 0) {
    throw new Error("apps/docs/docs.json must use navigation.versions for release docs");
  }

  const versionEntry = navigation.versions.find((entry) => entry.version === version);
  if (!versionEntry) {
    throw new Error(`apps/docs/docs.json is missing docs version ${version}`);
  }
  if (versionEntry.default !== true) {
    throw new Error(`Docs version ${version} must be marked default: true`);
  }
  if (versionEntry.tag !== latestTag) {
    throw new Error(`Docs version ${version} must be tagged ${JSON.stringify(latestTag)}`);
  }

  const versionDir = join(docsDir, version);
  if (!existsSync(versionDir) || !statSync(versionDir).isDirectory()) {
    throw new Error(`Missing docs snapshot directory ${relative(root, versionDir)}`);
  }

  const canaryEntry = navigation.versions.find((entry) => entry.version === canaryVersion);
  if (!canaryEntry) {
    throw new Error(`apps/docs/docs.json is missing the ${canaryVersion} docs version`);
  }
  if (canaryEntry.tag !== canaryTag) {
    throw new Error(`The ${canaryVersion} docs version must be tagged ${JSON.stringify(canaryTag)}`);
  }

  for (const entry of navigation.versions) {
    if (entry.version === version) continue;
    if (entry.default === true) {
      throw new Error(`Only ${version} may be default; ${entry.version} also has default: true`);
    }
    if (entry.tag === latestTag) {
      throw new Error(`Only ${version} may be tagged ${JSON.stringify(latestTag)}; ${entry.version} is also tagged`);
    }
  }

  const pages = pagesForVersion(versionEntry);
  if (pages.length === 0) {
    throw new Error(`Docs version ${version} has no pages`);
  }

  for (const page of pages) {
    if (!page.startsWith(`${version}/`)) {
      throw new Error(`Docs version ${version} page ${page} must live under ${version}/`);
    }
    const path = pagePath(page);
    if (!existsSync(path)) {
      throw new Error(`Docs version ${version} references missing page ${relative(root, path)}`);
    }
  }
}

function readDocsJson(): DocsJson {
  return JSON.parse(readFileSync(docsJsonPath, "utf8")) as DocsJson;
}

function writeDocsJson(value: DocsJson): void {
  writeFileSync(docsJsonPath, `${JSON.stringify(value, null, 2)}\n`);
}

function canaryPagesFor(docsJson: DocsJson): NavigationPage[] {
  const navigation = docsJson.navigation;
  if (!navigation) {
    throw new Error("apps/docs/docs.json is missing navigation");
  }

  if (navigation.versions) {
    const canary = navigation.versions.find((entry) => entry.version === canaryVersion);
    if (!canary) {
      throw new Error(`apps/docs/docs.json is missing the ${canaryVersion} docs version`);
    }
    if (canary.pages) return canary.pages;
    if (canary.groups) return canary.groups;
    throw new Error(`The ${canaryVersion} docs version must define pages or groups`);
  }

  if (navigation.pages) return navigation.pages;
  if (navigation.groups) return navigation.groups;
  throw new Error("apps/docs/docs.json navigation must define pages, groups, or versions");
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

function rewriteVersionedDocLinks(version: string): void {
  for (const file of listFiles(join(docsDir, version))) {
    const extension = extname(file);
    if (extension !== ".mdx" && extension !== ".md") continue;
    const source = readFileSync(file, "utf8");
    const next = rewriteAbsoluteDocLinks(source, version);
    if (next !== source) {
      writeFileSync(file, next);
    }
  }
}

function rewriteAbsoluteDocLinks(source: string, version: string): string {
  return source
    .replace(
      /(\]\()\/(?!v\d+\.\d+\.\d+\/|canary\/|\/|#|https?:\/\/)([^)\s]*)/g,
      `$1/${version}/$2`,
    )
    .replace(
      /(href=["'])\/(?!v\d+\.\d+\.\d+\/|canary\/|\/|#|https?:\/\/)([^"']*)/g,
      `$1/${version}/$2`,
    );
}

function updateDocsJsonForVersion(
  docsJson: DocsJson,
  version: string,
  canaryPages: NavigationPage[],
): void {
  const navigation = docsJson.navigation ?? {};
  const existingVersions = navigation.versions ?? [];
  const canaryEntry = existingVersions.find((entry) => entry.version === canaryVersion);
  const previousStable = existingVersions.filter((entry) =>
    entry.version !== canaryVersion && entry.version !== version
  );

  const nextCanary: NavigationVersion = {
    ...(canaryEntry ?? {}),
    version: canaryVersion,
    tag: canaryTag,
    pages: canaryPages,
  };
  delete nextCanary.default;
  delete nextCanary.groups;

  const nextStableVersions = previousStable.map((entry) => {
    const next = { ...entry };
    delete next.default;
    if (next.tag === latestTag) delete next.tag;
    return next;
  });

  docsJson.navigation = {
    ...navigation,
    versions: [
      {
        version,
        default: true,
        tag: latestTag,
        pages: prefixPages(canaryPages, version),
      },
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

function pagesForVersion(version: NavigationVersion): string[] {
  const roots: NavigationPage[] = version.pages ?? version.groups ?? [];
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
