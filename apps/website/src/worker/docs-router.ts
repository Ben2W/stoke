import {
  DOCS_VERSIONS,
  type ConfiguredDocsVersion,
} from "./docs-versions.ts";

const DOCS_ROOT = "/docs";
const DOCS_VERSION_MANIFEST_PATH = "/docs/api/versions.json";
const DOCS_VERSION_SELECTOR_PATH = "/docs/docs-version-selector.js";
const DOCS_ARCHIVE_PREFIX = /^\/docs\/(v\d+\.\d+)(?=\/|$)/;
const DEFAULT_DOCS_BINDING = "DOCS_LATEST";

type DocsServiceBinding = {
  fetch(request: Request): Promise<Response>;
};

export interface DocsRouterEnv {
  DOCS_LATEST?: DocsServiceBinding;
  [key: string]: unknown;
}

type ResolvedDocsVersion = Required<Pick<ConfiguredDocsVersion, "version" | "basePath" | "binding">>
  & Omit<ConfiguredDocsVersion, "version" | "basePath" | "binding">;

type PublicDocsVersion = Omit<ResolvedDocsVersion, "binding">;

export function isDocsPath(pathname: string) {
  return pathname === DOCS_ROOT || pathname.startsWith(`${DOCS_ROOT}/`);
}

export function docsHostRedirect(url: URL) {
  if (url.hostname !== "docs.rigkit.dev") return undefined;

  const target = new URL(url.toString());
  target.protocol = "https:";
  target.hostname = "www.rigkit.dev";
  target.port = "";
  target.pathname = target.pathname === "/"
    ? DOCS_ROOT
    : target.pathname.startsWith(`${DOCS_ROOT}/`)
      ? target.pathname
      : `${DOCS_ROOT}${target.pathname}`;
  return Response.redirect(target.toString(), 308);
}

export async function handleDocsRequest(
  request: Request,
  env: DocsRouterEnv,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (!isDocsPath(url.pathname)) return undefined;

  if (url.pathname === DOCS_VERSION_MANIFEST_PATH) {
    return docsVersionManifestResponse();
  }

  if (url.pathname === DOCS_VERSION_SELECTOR_PATH) {
    return docsVersionSelectorResponse();
  }

  const version = resolveDocsVersion(url.pathname, env);
  if (!version) {
    return new Response("Unknown docs version\n", {
      status: 404,
      headers: {
        "Cache-Control": "public, max-age=60, s-maxage=300",
        "Content-Type": "text/plain; charset=utf-8",
        "X-Robots-Tag": "noindex",
      },
    });
  }

  const binding = env[version.binding] as DocsServiceBinding | undefined;
  if (!binding || typeof binding.fetch !== "function") {
    return new Response(`Docs Worker binding ${version.binding} is not configured\n`, {
      status: 502,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; charset=utf-8",
        "X-Robots-Tag": "noindex",
      },
    });
  }

  const response = await binding.fetch(request);
  return decorateDocsResponse(request, response, version);
}

function docsVersions(): ResolvedDocsVersion[] {
  return DOCS_VERSIONS.map((entry) => normalizeDocsVersion(entry));
}

function normalizeDocsVersion(entry: ConfiguredDocsVersion): ResolvedDocsVersion {
  const basePath = normalizeBasePath(entry.basePath);
  return {
    ...entry,
    version: entry.version,
    label: entry.label ?? (entry.current ? `${entry.version} · Latest` : entry.version),
    basePath,
    startPath: entry.startPath ? normalizeBasePath(entry.startPath) : basePath,
    binding: entry.binding ?? bindingNameForBasePath(basePath),
    current: entry.current === true,
    archive: entry.archive === true || basePath !== DOCS_ROOT,
  };
}

function normalizeBasePath(pathname: string) {
  const normalized = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return normalized.replace(/\/+$/, "") || "/";
}

function bindingNameForBasePath(basePath: string) {
  const archive = basePath.match(/^\/docs\/(v\d+\.\d+)$/);
  if (!archive) return DEFAULT_DOCS_BINDING;
  return `DOCS_${archive[1].replace(/^v/, "V").replace(/\./g, "_")}`;
}

function resolveDocsVersion(pathname: string, env: DocsRouterEnv): ResolvedDocsVersion | undefined {
  const entries = docsVersions();
  const archive = pathname.match(DOCS_ARCHIVE_PREFIX);
  if (archive) {
    const basePath = `${DOCS_ROOT}/${archive[1]}`;
    const exactArchive = entries.find((entry) =>
      pathname === entry.basePath || pathname.startsWith(`${entry.basePath}/`),
    );
    if (exactArchive?.basePath === basePath) return exactArchive;

    const binding = bindingNameForBasePath(basePath);
    return env[binding] ? normalizeDocsVersion({
      version: archive[1],
      basePath,
      binding,
      archive: true,
    }) : undefined;
  }

  return entries.find((entry) =>
    pathname === entry.basePath || pathname.startsWith(`${entry.basePath}/`),
  ) ?? entries.find((entry) => entry.current) ?? entries.at(-1);
}

function docsVersionManifestResponse() {
  const entries: PublicDocsVersion[] = docsVersions().map(({ binding: _binding, ...entry }) => entry);
  return Response.json(
    {
      generatedAt: new Date().toISOString(),
      entries,
    },
    {
      headers: {
        "Cache-Control": "public, max-age=60, s-maxage=300",
      },
    },
  );
}

function docsVersionSelectorResponse() {
  return new Response(DOCS_VERSION_SELECTOR_JS, {
    headers: {
      "Cache-Control": "public, max-age=300, s-maxage=86400",
      "Content-Type": "application/javascript; charset=utf-8",
    },
  });
}

async function decorateDocsResponse(
  request: Request,
  response: Response,
  version: ResolvedDocsVersion,
) {
  const shouldNoindex = version.archive || !version.current;
  const withHeaders = withDocsHeaders(response, shouldNoindex);
  const contentType = withHeaders.headers.get("content-type") ?? "";

  if (
    request.method === "HEAD" ||
    withHeaders.status >= 300 ||
    !contentType.includes("text/html")
  ) {
    return withHeaders;
  }

  return injectDocsShell(withHeaders, shouldNoindex);
}

function withDocsHeaders(response: Response, shouldNoindex: boolean) {
  if (!shouldNoindex) return response;
  const headers = new Headers(response.headers);
  headers.set("X-Robots-Tag", "noindex");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function injectDocsShell(response: Response, shouldNoindex: boolean) {
  if (typeof HTMLRewriter !== "undefined") {
    let rewriter = new HTMLRewriter().on("body", {
      element(element) {
        element.append(`<script src="${DOCS_VERSION_SELECTOR_PATH}" defer></script>`, {
          html: true,
        });
      },
    });

    if (shouldNoindex) {
      rewriter = rewriter.on("head", {
        element(element) {
          element.append('<meta name="robots" content="noindex">', { html: true });
        },
      });
    }

    return rewriter.transform(response);
  }

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  let html = await response.text();
  if (shouldNoindex) {
    html = html.replace(/<\/head>/i, '<meta name="robots" content="noindex"></head>');
  }
  html = html.replace(
    /<\/body>/i,
    `<script src="${DOCS_VERSION_SELECTOR_PATH}" defer></script></body>`,
  );
  return new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

const DOCS_VERSION_SELECTOR_JS = `
(() => {
  const manifestUrl = "/docs/api/versions.json";

  function onPageLoad(callback) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", callback, { once: true });
    } else {
      callback();
    }
    document.addEventListener("astro:page-load", callback);
  }

  function normalize(path) {
    return path.replace(/\\/+$/, "") || "/";
  }

  function currentEntry(entries) {
    const pathname = normalize(location.pathname);
    return [...entries]
      .sort((a, b) => normalize(b.basePath).length - normalize(a.basePath).length)
      .find((entry) => {
        const basePath = normalize(entry.basePath);
        return pathname === basePath || pathname.startsWith(basePath + "/");
      }) || entries.find((entry) => entry.current) || entries[0];
  }

  function destinationFor(current, target) {
    const pathname = normalize(location.pathname);
    const currentBase = current ? normalize(current.basePath) : "/docs";
    const targetBase = normalize(target.basePath);
    const suffix = current && pathname.startsWith(currentBase + "/")
      ? pathname.slice(currentBase.length)
      : "";
    const path = suffix ? targetBase + suffix : (target.startPath || target.basePath || targetBase);
    return path + location.search + location.hash;
  }

  function ensurePicker() {
    const sidebar = document.querySelector(".sidebar");
    if (!sidebar) return undefined;

    let picker = sidebar.querySelector(".docs-global-version-picker");
    if (!picker) {
      picker = document.createElement("label");
      picker.className = "version-picker docs-global-version-picker";

      const label = document.createElement("span");
      label.textContent = "version";

      const select = document.createElement("select");
      select.className = "version-select";
      select.setAttribute("aria-label", "Documentation version");

      picker.append(label, select);
      sidebar.prepend(picker);
    }

    return picker.querySelector("select");
  }

  async function setupVersionPicker() {
    const select = ensurePicker();
    if (!select) return;

    let payload;
    try {
      const response = await fetch(manifestUrl, { headers: { accept: "application/json" } });
      if (!response.ok) return;
      payload = await response.json();
    } catch {
      return;
    }

    const entries = Array.isArray(payload.entries) ? payload.entries : [];
    if (!entries.length) return;

    const current = currentEntry(entries);
    select.replaceChildren(...entries.map((entry) => {
      const option = document.createElement("option");
      option.value = entry.version;
      option.textContent = entry.label || entry.version;
      option.selected = current && entry.version === current.version;
      return option;
    }));

    if (select.dataset.docsGlobalVersionBound === "1") return;
    select.dataset.docsGlobalVersionBound = "1";
    select.addEventListener("change", () => {
      const target = entries.find((entry) => entry.version === select.value);
      if (!target) return;
      location.href = destinationFor(currentEntry(entries), target);
    });
  }

  onPageLoad(setupVersionPicker);
})();
`.trim();
