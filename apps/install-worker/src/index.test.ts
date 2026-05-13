import { afterEach, describe, expect, test } from "bun:test";
import worker from "./index.ts";

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

describe("install worker", () => {
  test("serves latest release metadata from GitHub releases", async () => {
    mockGithubFetch();

    const response = await dispatch("https://rigkit.freestyle.sh/latest.json");
    expect(response.status).toBe(200);

    const body = await response.json() as MetadataBody;
    expect(body.version).toBe("0.1.6");
    expect(body.tag).toBe("v0.1.6");
    expect(body.installerUrl).toBe("https://rigkit.freestyle.sh/install");
    expect(body.downloads["darwin-arm64"]).toEqual({
      url: "https://rigkit.freestyle.sh/download/v0.1.6/darwin-arm64",
      githubUrl: "https://github.com/freestyle-sh/rigkit/releases/download/v0.1.6/rig-darwin-arm64.tar.gz",
      sha256: "a".repeat(64),
    });
  });

  test("redirects latest downloads to the GitHub release asset", async () => {
    mockGithubFetch();

    const response = await dispatch("https://rigkit.freestyle.sh/download/latest/darwin-arm64");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://github.com/freestyle-sh/rigkit/releases/download/v0.1.6/rig-darwin-arm64.tar.gz");
  });

  test("uses the GitHub token for release API requests when configured", async () => {
    const requests = mockGithubFetch();

    const response = await dispatch("https://rigkit.freestyle.sh/latest.json", {
      GITHUB_TOKEN: "github-token",
    });
    expect(response.status).toBe(200);

    const releaseRequest = requests.find((item) => item.url === "https://api.github.com/repos/freestyle-sh/rigkit/releases/latest");
    expect(releaseRequest?.headers.get("authorization")).toBe("Bearer github-token");
    expect(releaseRequest?.headers.get("x-github-api-version")).toBe("2022-11-28");
  });

  test("does not require the GitHub token locally", async () => {
    const requests = mockGithubFetch();

    const response = await dispatch("https://rigkit.freestyle.sh/latest.json");
    expect(response.status).toBe(200);

    const releaseRequest = requests.find((item) => item.url === "https://api.github.com/repos/freestyle-sh/rigkit/releases/latest");
    expect(releaseRequest?.headers.has("authorization")).toBe(false);
  });

  test("redirects versioned checksum requests to GitHub", async () => {
    mockGithubFetch();

    const response = await dispatch("https://rigkit.freestyle.sh/checksums/v0.1.6");
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://github.com/freestyle-sh/rigkit/releases/download/v0.1.6/checksums.txt");
  });

  test("serves an installer script that uses the worker endpoints", async () => {
    const response = await dispatch("https://rigkit.freestyle.sh/install");
    expect(response.status).toBe(200);

    const body = await response.text();
    expect(body).toContain('base_url="${RIGKIT_BASE_URL:-https://rigkit.freestyle.sh}"');
    expect(body).toContain('/download/latest/${target}');
    expect(body).toContain('/checksums/latest');
    expect(body).toContain('rig completion fish | source');
    expect(body).toContain('eval \\"\\$(rig completion zsh)\\"');
  });

  test("serves the rig hostname with canonical rigkit URLs", async () => {
    const response = await dispatch("https://rig.freestyle.sh/install");
    expect(response.status).toBe(200);

    const body = await response.text();
    expect(body).toContain('base_url="${RIGKIT_BASE_URL:-https://rigkit.freestyle.sh}"');
  });

  test("rejects unknown targets", async () => {
    mockGithubFetch();

    const response = await dispatch("https://rigkit.freestyle.sh/download/latest/windows-x64");
    expect(response.status).toBe(400);
    expect(await response.json() as ErrorBody).toEqual({ error: "Unknown target windows-x64. Expected darwin-arm64, darwin-x64, linux-arm64, linux-x64." });
  });
});

function dispatch(url: string, env: Partial<Record<"GITHUB_TOKEN", string>> = {}): Promise<Response> {
  return worker.fetch(new Request(url), {
    GITHUB_REPO: "freestyle-sh/rigkit",
    PUBLIC_BASE_URL: "https://rigkit.freestyle.sh",
    CACHE_TTL_SECONDS: "300",
    ...env,
  }, {
    waitUntil: () => undefined,
    passThroughOnException: () => undefined,
    props: undefined,
  } as ExecutionContext);
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
