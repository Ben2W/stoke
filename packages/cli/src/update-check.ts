import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { defaultRigkitHome } from "@rigkit/runtime-client";
import * as ui from "./ui.ts";

type NoticeStream = {
  isTTY?: boolean;
  write(chunk: string): unknown;
};

type LatestRelease = {
  version: string;
  tag?: string;
  installerUrl?: string;
  releaseUrl?: string;
};

type UpdateCache = {
  checkedAt: string;
  updateUrl: string;
  latest?: LatestRelease;
};

type UpdateCheckOptions = {
  commandName?: string;
  json: boolean;
  currentVersion: string;
  stream?: NoticeStream;
};

const DEFAULT_UPDATE_URL = "https://www.rigkit.dev/latest.json";
const DEFAULT_INSTALL_URL = "https://www.rigkit.dev/install";
const UPDATE_AVAILABLE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const NO_UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 900;

export async function maybePrintUpdateNotice(options: UpdateCheckOptions): Promise<void> {
  const stream = options.stream ?? process.stderr;
  const mode = normalizeUpdateCheckMode(process.env.RIGKIT_UPDATE_CHECK);
  if (!shouldCheckForUpdates(options, stream, mode)) return;

  const updateUrl = process.env.RIGKIT_UPDATE_URL?.trim() || DEFAULT_UPDATE_URL;
  const latest = await resolveLatestRelease(updateUrl, options.currentVersion, {
    force: mode === "force",
  });
  if (!latest || !isNewerVersion(latest.version, options.currentVersion)) return;

  stream.write(renderUpdateNotice({
    currentVersion: options.currentVersion,
    latest,
  }));
}

function shouldCheckForUpdates(
  options: UpdateCheckOptions,
  stream: NoticeStream,
  mode: ReturnType<typeof normalizeUpdateCheckMode>,
): boolean {
  if (options.json) return false;
  if (options.commandName === "completion") return false;

  if (mode === "off") return false;
  if (mode === "force") return true;
  if (process.env.CI) return false;
  return Boolean(stream.isTTY);
}

function normalizeUpdateCheckMode(value: string | undefined): "auto" | "force" | "off" {
  switch (value?.trim().toLowerCase()) {
    case "0":
    case "false":
    case "no":
    case "off":
      return "off";
    case "1":
    case "true":
    case "yes":
    case "on":
    case "force":
    case "always":
      return "force";
    default:
      return "auto";
  }
}

async function resolveLatestRelease(
  updateUrl: string,
  currentVersion: string,
  options: { force: boolean },
): Promise<LatestRelease | undefined> {
  const cached = readUpdateCache(updateUrl);
  if (!options.force && cached && isFreshCache(cached, currentVersion)) return cached.latest;

  const latest = await fetchLatestRelease(updateUrl);
  if (latest) {
    writeUpdateCache({ checkedAt: new Date().toISOString(), updateUrl, latest });
    return latest;
  }

  return cached?.latest;
}

function readUpdateCache(updateUrl: string): UpdateCache | undefined {
  const path = updateCachePath();
  if (!existsSync(path)) return undefined;

  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as UpdateCache;
    if (parsed.updateUrl !== updateUrl || !parsed.latest?.version) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function isFreshCache(cache: UpdateCache, currentVersion: string): boolean {
  const checkedAt = Date.parse(cache.checkedAt);
  if (!Number.isFinite(checkedAt)) return false;

  const interval = cache.latest && isNewerVersion(cache.latest.version, currentVersion)
    ? UPDATE_AVAILABLE_CHECK_INTERVAL_MS
    : NO_UPDATE_CHECK_INTERVAL_MS;
  return Date.now() - checkedAt < interval;
}

async function fetchLatestRelease(updateUrl: string): Promise<LatestRelease | undefined> {
  const timeoutMs = updateTimeoutMs();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(updateUrl, {
      headers: { "Accept": "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return undefined;

    const body = await response.json() as Partial<LatestRelease>;
    if (typeof body.version !== "string" || body.version.trim() === "") return undefined;
    return {
      version: body.version.trim(),
      tag: typeof body.tag === "string" ? body.tag : undefined,
      installerUrl: typeof body.installerUrl === "string" ? body.installerUrl : undefined,
      releaseUrl: typeof body.releaseUrl === "string" ? body.releaseUrl : undefined,
    };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

function writeUpdateCache(cache: UpdateCache): void {
  const path = updateCachePath();
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(cache, null, 2)}\n`);
  } catch {
    // Update checks are advisory. Cache failures should never affect a command.
  }
}

function updateCachePath(): string {
  return join(defaultRigkitHome(), "update-check.json");
}

function updateTimeoutMs(): number {
  const parsed = Number(process.env.RIGKIT_UPDATE_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

function renderUpdateNotice(input: { currentVersion: string; latest: LatestRelease }): string {
  const installUrl = input.latest.installerUrl || DEFAULT_INSTALL_URL;
  return [
    "",
    `${ui.warn("!")} ${ui.bold(`rig ${input.latest.version} is available`)} ${ui.dim(`(current ${input.currentVersion})`)}`,
    ui.hint(`update with: curl -fsSL ${installUrl} | sh`),
  ].join("\n") + "\n";
}

function isNewerVersion(candidate: string, current: string): boolean {
  const parsedCandidate = parseSemver(candidate);
  const parsedCurrent = parseSemver(current);
  if (!parsedCandidate || !parsedCurrent) return false;
  return compareSemver(parsedCandidate, parsedCurrent) > 0;
}

type Semver = {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
};

function parseSemver(value: string): Semver | undefined {
  const match = value.trim().replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) return undefined;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

function compareSemver(left: Semver, right: Semver): number {
  for (const key of ["major", "minor", "patch"] as const) {
    const delta = left[key] - right[key];
    if (delta !== 0) return delta;
  }

  if (left.prerelease.length === 0 && right.prerelease.length > 0) return 1;
  if (left.prerelease.length > 0 && right.prerelease.length === 0) return -1;

  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left.prerelease[index];
    const rightPart = right.prerelease[index];
    if (leftPart === undefined && rightPart === undefined) return 0;
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;

    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) {
      const delta = Number(leftPart) - Number(rightPart);
      if (delta !== 0) return delta;
      continue;
    }
    if (leftNumeric) return -1;
    if (rightNumeric) return 1;

    const delta = leftPart.localeCompare(rightPart);
    if (delta !== 0) return delta;
  }

  return 0;
}
