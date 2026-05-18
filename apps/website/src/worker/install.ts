export type InstallEnv = {
  GITHUB_REPO?: string;
  GITHUB_TOKEN?: string;
  PUBLIC_BASE_URL?: string;
  CACHE_TTL_SECONDS?: string;
};

type GithubRelease = {
  tag_name: string;
  name?: string | null;
  body?: string | null;
  target_commitish?: string;
  published_at: string | null;
  created_at?: string | null;
  html_url: string;
  prerelease?: boolean;
  draft?: boolean;
  assets: GithubAsset[];
};

export type ReleaseSummary = {
  tag: string;
  name: string;
  body: string;
  prerelease: boolean;
  draft: boolean;
  publishedAt: string | null;
  createdAt: string | null;
  htmlUrl: string;
  isCanary: boolean;
};

type GithubAsset = {
  name: string;
  browser_download_url: string;
};

type Target = "darwin-arm64" | "darwin-x64" | "linux-arm64" | "linux-x64";

type DownloadInfo = {
  url: string;
  githubUrl: string;
  sha256?: string;
};

type LatestMetadata = {
  name: "rigkit";
  repo: string;
  version: string;
  tag: string;
  commitish?: string;
  releasedAt: string | null;
  releaseUrl: string;
  installerUrl: string;
  checksums: {
    url: string;
    githubUrl: string;
  };
  downloads: Record<Target, DownloadInfo>;
};

const TARGETS: Target[] = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"];
const DEFAULT_REPO = "freestyle-sh/rigkit";
const DEFAULT_CACHE_TTL_SECONDS = 30;
const CANARY_TAG_PATTERN = /^0\.0\.0-canary-/;

const INSTALL_PATHS = new Set([
  "/install",
  "/install/canary",
  "/latest",
  "/latest.json",
  "/canary/latest.json",
  "/api/releases",
]);

export function isInstallPath(pathname: string): boolean {
  if (INSTALL_PATHS.has(pathname)) return true;
  if (pathname.startsWith("/install/version/")) return true;
  if (pathname.startsWith("/download/")) return true;
  if (pathname.startsWith("/checksums/")) return true;
  return false;
}

export function isCanaryTag(tag: string): boolean {
  return CANARY_TAG_PATTERN.test(tag);
}

export async function handleInstallRequest(
  request: Request,
  env: InstallEnv,
  ctx?: ExecutionContext,
): Promise<Response> {
  try {
    return await dispatch(request, env, ctx);
  } catch (error) {
    const message = error instanceof HttpError ? error.message : "Internal server error";
    const status = error instanceof HttpError ? error.status : 500;
    if (!(error instanceof HttpError)) console.error(error);
    return json({ error: message }, { status, cacheControl: "no-store" });
  }
}

async function dispatch(request: Request, env: InstallEnv, ctx?: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);

  if (request.method !== "GET" && request.method !== "HEAD") {
    return json({ error: "Method not allowed" }, { status: 405, cacheControl: "no-store" });
  }

  if (url.pathname === "/install") {
    return text(renderInstallScript(resolvePublicBaseUrl(request, env), "latest"), {
      contentType: "text/x-shellscript; charset=utf-8",
      cacheControl: "public, max-age=300",
    });
  }

  if (url.pathname === "/install/canary") {
    return text(renderInstallScript(resolvePublicBaseUrl(request, env), "canary"), {
      contentType: "text/x-shellscript; charset=utf-8",
      cacheControl: "public, max-age=300",
    });
  }

  const versionInstallMatch = url.pathname.match(/^\/install\/version\/(.+?)\/?$/);
  if (versionInstallMatch) {
    const raw = decodeURIComponent(versionInstallMatch[1]!);
    const spec = normalizeInstallSpec(raw);
    return text(renderInstallScript(resolvePublicBaseUrl(request, env), spec), {
      contentType: "text/x-shellscript; charset=utf-8",
      cacheControl: "public, max-age=300",
    });
  }

  if (url.pathname === "/latest" || url.pathname === "/latest.json") {
    const metadata = await getLatestMetadata(request, env, ctx);
    return json(metadata, { cacheControl: latestMetadataCacheControl(env) });
  }

  if (url.pathname === "/canary/latest.json") {
    const metadata = await getLatestCanaryMetadata(request, env, ctx);
    return json(metadata, { cacheControl: latestMetadataCacheControl(env) });
  }

  if (url.pathname === "/api/releases") {
    const releases = await getReleasesList(request, env, ctx);
    return json(releases, { cacheControl: latestMetadataCacheControl(env) });
  }

  const downloadMatch = url.pathname.match(/^\/download\/([^/]+)\/([^/]+)$/);
  if (downloadMatch) {
    const version = decodeURIComponent(downloadMatch[1]!);
    const target = normalizeTarget(decodeURIComponent(downloadMatch[2]!));
    const metadata = await resolveMetadata(request, env, ctx, version);
    const download = metadata.downloads[target];
    if (!download) throw new HttpError(404, `No ${target} asset for ${metadata.tag}`);
    const isChannel = version === "latest" || version === "canary";
    return redirect(
      download.githubUrl,
      isChannel ? 302 : 307,
      isChannel ? latestRedirectCacheControl(env) : "public, max-age=31536000, immutable",
    );
  }

  const checksumsMatch = url.pathname.match(/^\/checksums\/([^/]+)$/);
  if (checksumsMatch) {
    const version = decodeURIComponent(checksumsMatch[1]!);
    const metadata = await resolveMetadata(request, env, ctx, version);
    const isChannel = version === "latest" || version === "canary";
    return redirect(
      metadata.checksums.githubUrl,
      isChannel ? 302 : 307,
      isChannel ? latestRedirectCacheControl(env) : "public, max-age=31536000, immutable",
    );
  }

  return json({ error: "Not found" }, { status: 404, cacheControl: "no-store" });
}

async function resolveMetadata(
  request: Request,
  env: InstallEnv,
  ctx: ExecutionContext | undefined,
  version: string,
): Promise<LatestMetadata> {
  if (version === "latest") return await getLatestMetadata(request, env, ctx);
  if (version === "canary") return await getLatestCanaryMetadata(request, env, ctx);
  return await getReleaseMetadata(request, env, normalizeVersion(version));
}

async function getLatestMetadata(request: Request, env: InstallEnv, ctx?: ExecutionContext): Promise<LatestMetadata> {
  const cacheKey = new Request(new URL(`/__cache/latest/${repo(env)}`, request.url), { method: "GET" });
  const cached = await cacheMatch(cacheKey);
  if (cached) return await cached.json() as LatestMetadata;

  const release = await fetchGithubRelease(env, "latest");
  const metadata = await buildMetadata(request, env, release);
  const response = json(metadata, { cacheControl: `public, max-age=${cacheTtl(env)}` });
  const put = cachePut(cacheKey, response);
  if (ctx) ctx.waitUntil(put);
  else await put;
  return metadata;
}

async function getReleaseMetadata(request: Request, env: InstallEnv, tag: string): Promise<LatestMetadata> {
  const release = await fetchGithubRelease(env, `tags/${tag}`);
  return await buildMetadata(request, env, release);
}

async function getLatestCanaryMetadata(
  request: Request,
  env: InstallEnv,
  ctx?: ExecutionContext,
): Promise<LatestMetadata> {
  const cacheKey = new Request(new URL(`/__cache/canary/${repo(env)}`, request.url), { method: "GET" });
  const cached = await cacheMatch(cacheKey);
  if (cached) return await cached.json() as LatestMetadata;

  const releases = await fetchReleasesList(env);
  const canary = releases.find(
    (release) => release.prerelease && isCanaryTag(release.tag_name),
  );

  if (!canary) {
    throw new HttpError(404, "No canary release published yet");
  }

  const metadata = await buildMetadata(request, env, canary);
  const response = json(metadata, { cacheControl: `public, max-age=${cacheTtl(env)}` });
  const put = cachePut(cacheKey, response);
  if (ctx) ctx.waitUntil(put);
  else await put;
  return metadata;
}

async function getReleasesList(
  request: Request,
  env: InstallEnv,
  ctx?: ExecutionContext,
): Promise<ReleaseSummary[]> {
  const cacheKey = new Request(new URL(`/__cache/releases/${repo(env)}`, request.url), { method: "GET" });
  const cached = await cacheMatch(cacheKey);
  if (cached) return await cached.json() as ReleaseSummary[];

  const releases = await fetchReleasesList(env);
  const summaries = releases.map(summarizeRelease);
  const response = json(summaries, { cacheControl: `public, max-age=${cacheTtl(env)}` });
  const put = cachePut(cacheKey, response);
  if (ctx) ctx.waitUntil(put);
  else await put;
  return summaries;
}

function summarizeRelease(release: GithubRelease): ReleaseSummary {
  return {
    tag: release.tag_name,
    name: release.name ?? release.tag_name,
    body: release.body ?? "",
    prerelease: Boolean(release.prerelease),
    draft: Boolean(release.draft),
    publishedAt: release.published_at,
    createdAt: release.created_at ?? release.published_at,
    htmlUrl: release.html_url,
    isCanary: isCanaryTag(release.tag_name),
  };
}

async function buildMetadata(request: Request, env: InstallEnv, release: GithubRelease): Promise<LatestMetadata> {
  const baseUrl = resolvePublicBaseUrl(request, env);
  const version = release.tag_name.startsWith("v") ? release.tag_name.slice(1) : release.tag_name;
  const checksumsAsset = findAsset(release, "checksums.txt");
  const checksums = await fetchChecksums(checksumsAsset.browser_download_url);
  const downloads = Object.fromEntries(
    TARGETS.map((target) => {
      const assetName = assetNameForTarget(target);
      const asset = findAsset(release, assetName);
      return [
        target,
        {
          url: `${baseUrl}/download/${release.tag_name}/${target}`,
          githubUrl: asset.browser_download_url,
          sha256: checksums[assetName],
        },
      ];
    }),
  ) as Record<Target, DownloadInfo>;

  return {
    name: "rigkit",
    repo: repo(env),
    version,
    tag: release.tag_name,
    commitish: release.target_commitish,
    releasedAt: release.published_at,
    releaseUrl: release.html_url,
    installerUrl: `${baseUrl}/install`,
    checksums: {
      url: `${baseUrl}/checksums/${release.tag_name}`,
      githubUrl: checksumsAsset.browser_download_url,
    },
    downloads,
  };
}

async function fetchGithubRelease(env: InstallEnv, path: "latest" | `tags/${string}`): Promise<GithubRelease> {
  const response = await fetch(`https://api.github.com/repos/${repo(env)}/releases/${path}`, {
    headers: githubApiHeaders(env),
  });

  if (response.status === 404) {
    throw new HttpError(404, `Release not found`);
  }

  if (!response.ok) {
    const hint = response.status === 403
      ? githubToken(env)
        ? ". Check GITHUB_TOKEN permissions or rate limit."
        : ". Configure the GITHUB_TOKEN Worker secret to avoid anonymous GitHub API limits."
      : "";
    throw new HttpError(502, `GitHub release lookup failed with ${response.status}${hint}`);
  }

  return await response.json() as GithubRelease;
}

async function fetchReleasesList(env: InstallEnv): Promise<GithubRelease[]> {
  const response = await fetch(
    `https://api.github.com/repos/${repo(env)}/releases?per_page=100`,
    { headers: githubApiHeaders(env) },
  );

  if (!response.ok) {
    const hint = response.status === 403
      ? githubToken(env)
        ? ". Check GITHUB_TOKEN permissions or rate limit."
        : ". Configure the GITHUB_TOKEN Worker secret to avoid anonymous GitHub API limits."
      : "";
    throw new HttpError(502, `GitHub releases lookup failed with ${response.status}${hint}`);
  }

  return (await response.json() as GithubRelease[]).filter((release) => !release.draft);
}

function githubApiHeaders(env: InstallEnv): Headers {
  const headers = new Headers({
    "Accept": "application/vnd.github+json",
    "User-Agent": "rigkit-install-worker",
    "X-GitHub-Api-Version": "2022-11-28",
  });

  const token = githubToken(env);
  if (token) headers.set("Authorization", `Bearer ${token}`);

  return headers;
}

function githubToken(env: InstallEnv): string | undefined {
  const token = env.GITHUB_TOKEN?.trim();
  return token || undefined;
}

async function fetchChecksums(url: string): Promise<Record<string, string>> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "rigkit-install-worker",
    },
  });

  if (!response.ok) {
    throw new HttpError(502, `Checksum lookup failed with ${response.status}`);
  }

  const text = await response.text();
  const checksums: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.trim().match(/^([a-f0-9]{64})\s+\*?(.+)$/i);
    if (match) checksums[match[2]!] = match[1]!;
  }
  return checksums;
}

function findAsset(release: GithubRelease, name: string): GithubAsset {
  const asset = release.assets.find((item) => item.name === name);
  if (!asset) throw new HttpError(502, `Release ${release.tag_name} is missing ${name}`);
  return asset;
}

function normalizeTarget(value: string): Target {
  const normalized = value
    .replace(/^rig-/, "")
    .replace(/\.tar\.gz$/, "");
  if (TARGETS.includes(normalized as Target)) return normalized as Target;
  throw new HttpError(400, `Unknown target ${value}. Expected ${TARGETS.join(", ")}.`);
}

function normalizeVersion(value: string): string {
  if (value.startsWith("v")) return value;
  if (isCanaryTag(value)) return value;
  return `v${value}`;
}

function normalizeInstallSpec(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.toLowerCase() === "latest") return "latest";
  if (trimmed.toLowerCase() === "canary") return "canary";
  return trimmed;
}

function assetNameForTarget(target: Target): string {
  return `rig-${target}.tar.gz`;
}

function repo(env: InstallEnv): string {
  return env.GITHUB_REPO || DEFAULT_REPO;
}

function resolvePublicBaseUrl(request: Request, env: InstallEnv): string {
  return (env.PUBLIC_BASE_URL || new URL(request.url).origin).replace(/\/+$/, "");
}

function cacheTtl(env: InstallEnv): number {
  const parsed = Number(env.CACHE_TTL_SECONDS);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_CACHE_TTL_SECONDS;
}

function latestMetadataCacheControl(env: InstallEnv): string {
  const ttl = cacheTtl(env);
  return `public, max-age=${ttl}, s-maxage=${ttl}`;
}

function latestRedirectCacheControl(env: InstallEnv): string {
  return `public, max-age=${cacheTtl(env)}`;
}

async function cacheMatch(request: Request): Promise<Response | undefined> {
  if (typeof caches === "undefined") return undefined;
  const edgeCache = caches as CacheStorage & { default: Cache };
  return await edgeCache.default.match(request);
}

async function cachePut(request: Request, response: Response): Promise<void> {
  if (typeof caches === "undefined") return;
  const edgeCache = caches as CacheStorage & { default: Cache };
  await edgeCache.default.put(request, response.clone());
}

function redirect(url: string, status: 302 | 307, cacheControl: string): Response {
  return new Response(null, {
    status,
    headers: {
      "Location": url,
      "Cache-Control": cacheControl,
    },
  });
}

function json(value: unknown, options: { status?: number; cacheControl?: string } = {}): Response {
  return new Response(JSON.stringify(value, null, 2), {
    status: options.status ?? 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": options.cacheControl ?? "no-store",
    },
  });
}

function text(value: string, options: { status?: number; contentType: string; cacheControl?: string }): Response {
  return new Response(value, {
    status: options.status ?? 200,
    headers: {
      "Content-Type": options.contentType,
      "Cache-Control": options.cacheControl ?? "no-store",
    },
  });
}

function renderInstallScript(baseUrl: string, spec: string): string {
  const defaultVersion = spec;
  const isCanary = spec === "canary" || isCanaryTag(spec);
  const banner = isCanary
    ? "echo \"Installing rig CANARY build — for testing only.\""
    : "";
  return `#!/usr/bin/env sh
set -eu

base_url="\${RIGKIT_BASE_URL:-${baseUrl}}"
version="\${RIGKIT_VERSION:-${defaultVersion}}"
rigkit_home="\${RIGKIT_HOME:-$HOME/.rigkit}"
install_dir="\${RIGKIT_INSTALL_DIR:-$rigkit_home/bin}"

${banner}

os="$(uname -s)"
arch="$(uname -m)"
shell_name="$(basename "\${SHELL:-}")"

case "$os" in
  Darwin) os_name="darwin" ;;
  Linux) os_name="linux" ;;
  *) echo "Unsupported OS: $os" >&2; exit 1 ;;
esac

case "$arch" in
  arm64|aarch64) arch_name="arm64" ;;
  x86_64|amd64) arch_name="x64" ;;
  *) echo "Unsupported architecture: $arch" >&2; exit 1 ;;
esac

target="\${os_name}-\${arch_name}"
asset="rig-\${target}.tar.gz"

if [ "$version" = "latest" ] || [ "$version" = "canary" ]; then
  download_url="\${base_url}/download/\${version}/\${target}"
  checksum_url="\${base_url}/checksums/\${version}"
else
  case "$version" in
    v*) tag="$version" ;;
    0.0.0-canary-*) tag="$version" ;;
    *) tag="v$version" ;;
  esac
  download_url="\${base_url}/download/\${tag}/\${target}"
  checksum_url="\${base_url}/checksums/\${tag}"
fi

update_path() {
  case ":$PATH:" in
    *":$install_dir:"*) return ;;
  esac

  if [ "\${RIGKIT_NO_MODIFY_PATH:-}" = "1" ]; then
    print_path_instructions
    return
  fi

  profile="$(detect_profile)"
  if [ -z "$profile" ]; then
    print_path_instructions
    return
  fi

  mkdir -p "$(dirname "$profile")"
  touch "$profile"

  if grep -F "$install_dir" "$profile" >/dev/null 2>&1; then
    echo ""
    echo "rig install directory is already referenced in $profile"
    print_current_shell_instructions
    return
  fi

  case "$profile" in
    *.fish)
      {
        echo ""
        echo "# rigkit"
        echo "fish_add_path \\"$install_dir\\""
        echo "$(completion_profile_line)"
      } >> "$profile"
      ;;
    *)
      {
        echo ""
        echo "# rigkit"
        echo "export PATH=\\"$install_dir:\\$PATH\\""
        echo "$(completion_profile_line)"
      } >> "$profile"
      ;;
  esac

  echo ""
  echo "Added rig to PATH and enabled shell completion in $profile"
  print_current_shell_instructions
}

detect_profile() {
  if [ -n "\${RIGKIT_PROFILE:-}" ]; then
    echo "$RIGKIT_PROFILE"
    return
  fi

  case "$shell_name" in
    zsh)
      echo "$HOME/.zshrc"
      return
      ;;
    bash)
      if [ "$os_name" = "darwin" ]; then
        echo "$HOME/.bash_profile"
      else
        echo "$HOME/.bashrc"
      fi
      return
      ;;
    fish)
      echo "$HOME/.config/fish/config.fish"
      return
      ;;
  esac

  if [ -f "$HOME/.zshrc" ]; then
    echo "$HOME/.zshrc"
  elif [ -f "$HOME/.bashrc" ]; then
    echo "$HOME/.bashrc"
  elif [ -f "$HOME/.profile" ]; then
    echo "$HOME/.profile"
  else
    echo "$HOME/.profile"
  fi
}

print_path_instructions() {
  echo ""
  echo "Add this to your shell profile:"
  case "$shell_name" in
    fish)
      echo "  fish_add_path \\"$install_dir\\""
      echo "  $(completion_profile_line)"
      ;;
    *)
      echo "  export PATH=\\"$install_dir:\\$PATH\\""
      echo "  $(completion_profile_line)"
      ;;
  esac
  print_current_shell_instructions
}

print_current_shell_instructions() {
  echo "Restart your shell, or run this now:"
  case "$shell_name" in
    fish)
      echo "  set -gx PATH \\"$install_dir\\" \\$PATH"
      echo "  $(completion_profile_line)"
      ;;
    *)
      echo "  export PATH=\\"$install_dir:\\$PATH\\""
      echo "  $(completion_profile_line)"
      ;;
  esac
}

completion_profile_line() {
  case "$shell_name" in
    fish) echo "rig completion fish | source" ;;
    bash) echo "eval \\"\\$(rig completion bash)\\"" ;;
    *) echo "eval \\"\\$(rig completion zsh)\\"" ;;
  esac
}

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

echo "Downloading \${asset} from \${base_url}..."
curl -fsSL "$download_url" -o "$tmp_dir/$asset"
curl -fsSL "$checksum_url" -o "$tmp_dir/checksums.txt"

expected="$(grep " \${asset}$" "$tmp_dir/checksums.txt" | awk '{print $1}')"
if [ -z "$expected" ]; then
  echo "Could not find checksum for \${asset}" >&2
  exit 1
fi

if command -v shasum >/dev/null 2>&1; then
  actual="$(shasum -a 256 "$tmp_dir/$asset" | awk '{print $1}')"
elif command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$tmp_dir/$asset" | awk '{print $1}')"
else
  echo "Could not find shasum or sha256sum to verify download" >&2
  exit 1
fi

if [ "$actual" != "$expected" ]; then
  echo "Checksum mismatch for \${asset}" >&2
  exit 1
fi

tar -xzf "$tmp_dir/$asset" -C "$tmp_dir"
mkdir -p "$install_dir"
mv "$tmp_dir/rig-\${target}" "$install_dir/rig"
chmod +x "$install_dir/rig"

echo "Installed rig to $install_dir/rig"

update_path

"$install_dir/rig" --version
`;
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}
