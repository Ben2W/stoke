import { afterEach, describe, expect, test } from "bun:test";
import worker from "./worker.ts";

type MetadataBody = {
  version: string;
  tag: string;
  installerUrl: string;
  downloads: Record<string, unknown>;
};

type ErrorBody = {
  error: string;
};

const release = {
  tag_name: "v0.1.6",
  target_commitish: "941775b",
  published_at: "2026-05-02T23:18:46Z",
  html_url: "https://github.com/freestyle-sh/rigkit/releases/tag/v0.1.6",
  assets: [
    asset("checksums.txt"),
    asset("rig-darwin-arm64.tar.gz"),
    asset("rig-darwin-x64.tar.gz"),
    asset("rig-linux-arm64.tar.gz"),
    asset("rig-linux-x64.tar.gz"),
  ],
};

const checksums = [
  `${"a".repeat(64)}  rig-darwin-arm64.tar.gz`,
  `${"b".repeat(64)}  rig-darwin-x64.tar.gz`,
  `${"c".repeat(64)}  rig-linux-arm64.tar.gz`,
  `${"d".repeat(64)}  rig-linux-x64.tar.gz`,
].join("\n");

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("website worker · install routes", () => {
  test("serves latest release metadata from GitHub releases", async () => {
    mockGithubFetch();

    const response = await dispatch("https://rigkit.dev/latest.json");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=30, s-maxage=30");

    const body = await response.json() as MetadataBody;
    expect(body.version).toBe("0.1.6");
    expect(body.tag).toBe("v0.1.6");
    expect(body.installerUrl).toBe("https://rigkit.dev/install");
    expect(body.downloads["darwin-arm64"]).toEqual({
      url: "https://rigkit.dev/download/v0.1.6/darwin-arm64",
      githubUrl: "https://github.com/freestyle-sh/rigkit/releases/download/v0.1.6/rig-darwin-arm64.tar.gz",
      sha256: "a".repeat(64),
    });
  });

  test("redirects latest downloads to the GitHub release asset", async () => {
    mockGithubFetch();

    const response = await dispatch("https://rigkit.dev/download/latest/darwin-arm64");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://github.com/freestyle-sh/rigkit/releases/download/v0.1.6/rig-darwin-arm64.tar.gz");
    expect(response.headers.get("cache-control")).toBe("public, max-age=30");
  });

  test("uses the GitHub token for release API requests when configured", async () => {
    const requests = mockGithubFetch();

    const response = await dispatch("https://rigkit.dev/latest.json", {
      GITHUB_TOKEN: "github-token",
    });
    expect(response.status).toBe(200);

    const releaseRequest = requests.find((item) => item.url === "https://api.github.com/repos/freestyle-sh/rigkit/releases/latest");
    expect(releaseRequest?.headers.get("authorization")).toBe("Bearer github-token");
    expect(releaseRequest?.headers.get("x-github-api-version")).toBe("2022-11-28");
  });

  test("does not require the GitHub token locally", async () => {
    const requests = mockGithubFetch();

    const response = await dispatch("https://rigkit.dev/latest.json");
    expect(response.status).toBe(200);

    const releaseRequest = requests.find((item) => item.url === "https://api.github.com/repos/freestyle-sh/rigkit/releases/latest");
    expect(releaseRequest?.headers.has("authorization")).toBe(false);
  });

  test("redirects versioned checksum requests to GitHub", async () => {
    mockGithubFetch();

    const response = await dispatch("https://rigkit.dev/checksums/v0.1.6");
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://github.com/freestyle-sh/rigkit/releases/download/v0.1.6/checksums.txt");
  });

  test("serves an installer script that uses the worker endpoints", async () => {
    const response = await dispatch("https://rigkit.dev/install");
    expect(response.status).toBe(200);

    const body = await response.text();
    expect(body).toContain('base_url="${RIGKIT_BASE_URL:-https://rigkit.dev}"');
    expect(body).toContain('version="${RIGKIT_VERSION:-latest}"');
    expect(body).toContain('/download/${version}/${target}');
    expect(body).toContain('/checksums/${version}');
    expect(body).toContain('rig completion fish | source');
    expect(body).toContain('eval \\"\\$(rig completion zsh)\\"');
    expect(body).toContain('echo "Shell setup"');
    expect(body).toContain('rig is already on PATH for this terminal.');
    expect(body).toContain('Restart your terminal, or refresh $shell_label now:');
    expect(body).toContain('source \\"$profile\\"');
    expect(body).toContain('Restart your terminal, or run this command to use rig in $shell_label now:');
  });

  test("serves a canary installer script targeting the canary channel", async () => {
    const response = await dispatch("https://rigkit.dev/install/canary");
    expect(response.status).toBe(200);

    const body = await response.text();
    expect(body).toContain('version="${RIGKIT_VERSION:-canary}"');
    expect(body).toContain('Installing rig CANARY build');
  });

  test("serves the installer with canonical rigkit.dev URLs", async () => {
    const response = await dispatch("https://rigkit.dev/install");
    expect(response.status).toBe(200);

    const body = await response.text();
    expect(body).toContain('base_url="${RIGKIT_BASE_URL:-https://rigkit.dev}"');
  });

  test("rejects unknown targets", async () => {
    mockGithubFetch();

    const response = await dispatch("https://rigkit.dev/download/latest/windows-x64");
    expect(response.status).toBe(400);
    expect(await response.json() as ErrorBody).toEqual({ error: "Unknown target windows-x64. Expected darwin-arm64, darwin-x64, linux-arm64, linux-x64." });
  });

  test("forwards non-install routes to the static asset binding", async () => {
    const assetCalls: string[] = [];
    const env: Env = {
      GITHUB_REPO: "freestyle-sh/rigkit",
      PUBLIC_BASE_URL: "https://rigkit.dev",
      CACHE_TTL_SECONDS: "30",
      ASSETS: {
        async fetch(request: Request) {
          assetCalls.push(new URL(request.url).pathname);
          return new Response("<html>hello</html>", {
            status: 200,
            headers: { "content-type": "text/html" },
          });
        },
      },
    };

    const response = await worker.fetch(new Request("https://rigkit.dev/"), env, ctx());
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("<html>hello</html>");
    expect(assetCalls).toEqual(["/index.html"]);
  });

  test("redirects docs.rigkit.dev to canonical /docs URLs", async () => {
    const cases = [
      ["https://docs.rigkit.dev/", "https://rigkit.dev/docs"],
      ["https://docs.rigkit.dev/guides/quickstart?foo=1", "https://rigkit.dev/docs/guides/quickstart?foo=1"],
      ["https://docs.rigkit.dev/docs/reference/cli#version", "https://rigkit.dev/docs/reference/cli#version"],
      ["http://docs.rigkit.dev/providers", "https://rigkit.dev/docs/providers"],
    ] as const;

    for (const [input, location] of cases) {
      const response = await worker.fetch(new Request(input), noopAssetsEnv(), ctx());
      expect(response.status).toBe(308);
      expect(response.headers.get("location")).toBe(location);
    }
  });

  test("proxies /docs to Mintlify", async () => {
    const proxyCalls: { url: string; host: string | null; forwardedHost: string | null }[] = [];
    globalThis.fetch = (async (input: Request | string | URL) => {
      const req = input instanceof Request ? input : new Request(input);
      proxyCalls.push({
        url: req.url,
        host: req.headers.get("Host"),
        forwardedHost: req.headers.get("X-Forwarded-Host"),
      });
      return new Response("<html>mintlify</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }) as typeof fetch;

    const response = await worker.fetch(
      new Request("https://rigkit.dev/docs"),
      noopAssetsEnv(),
      ctx(),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("<html>mintlify</html>");
    expect(proxyCalls).toEqual([
      {
        url: "https://freestyle.mintlify.dev/docs",
        host: "freestyle.mintlify.dev",
        forwardedHost: "rigkit.dev",
      },
    ]);
  });

  test("proxies nested /docs/* paths to Mintlify with query preserved", async () => {
    const proxyUrls: string[] = [];
    globalThis.fetch = (async (input: Request | string | URL) => {
      const req = input instanceof Request ? input : new Request(input);
      proxyUrls.push(req.url);
      return new Response("ok");
    }) as typeof fetch;

    const response = await worker.fetch(
      new Request("https://rigkit.dev/docs/guides/quickstart?foo=1"),
      noopAssetsEnv(),
      ctx(),
    );
    expect(response.status).toBe(200);
    expect(proxyUrls).toEqual([
      "https://freestyle.mintlify.dev/docs/guides/quickstart?foo=1",
    ]);
  });
});

function noopAssetsEnv(): Env {
  return {
    GITHUB_REPO: "freestyle-sh/rigkit",
    PUBLIC_BASE_URL: "https://rigkit.dev",
    CACHE_TTL_SECONDS: "30",
    ASSETS: {
      async fetch() {
        throw new Error("ASSETS.fetch should not be called for /docs paths");
      },
    },
  };
}

type Env = {
  GITHUB_REPO?: string;
  GITHUB_TOKEN?: string;
  PUBLIC_BASE_URL?: string;
  CACHE_TTL_SECONDS?: string;
  ASSETS: { fetch(request: Request): Promise<Response> };
};

function dispatch(url: string, overrides: Partial<Record<"GITHUB_TOKEN", string>> = {}): Promise<Response> {
  const env: Env = {
    GITHUB_REPO: "freestyle-sh/rigkit",
    PUBLIC_BASE_URL: "https://rigkit.dev",
    CACHE_TTL_SECONDS: "30",
    ASSETS: {
      async fetch() {
        throw new Error("ASSETS.fetch should not be called for install paths");
      },
    },
    ...overrides,
  };

  return worker.fetch(new Request(url), env, ctx());
}

function ctx(): ExecutionContext {
  return {
    waitUntil: () => undefined,
    passThroughOnException: () => undefined,
    props: undefined,
  } as ExecutionContext;
}

function mockGithubFetch(): Array<{ url: string; headers: Headers }> {
  const requests: Array<{ url: string; headers: Headers }> = [];

  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    requests.push({ url, headers: new Headers(input instanceof Request ? input.headers : init?.headers) });

    if (url === "https://api.github.com/repos/freestyle-sh/rigkit/releases/latest") {
      return Response.json(release);
    }
    if (url === "https://api.github.com/repos/freestyle-sh/rigkit/releases/tags/v0.1.6") {
      return Response.json(release);
    }
    if (url === "https://github.com/freestyle-sh/rigkit/releases/download/v0.1.6/checksums.txt") {
      return new Response(checksums, { headers: { "content-type": "text/plain" } });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  return requests;
}

function asset(name: string): { name: string; browser_download_url: string } {
  return {
    name,
    browser_download_url: `https://github.com/freestyle-sh/rigkit/releases/download/v0.1.6/${name}`,
  };
}
