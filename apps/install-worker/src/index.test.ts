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
  html_url: "https://github.com/freestyle-sh/fdev/releases/tag/v0.1.6",
  assets: [
    asset("checksums.txt"),
    asset("fdev-darwin-arm64.tar.gz"),
    asset("fdev-darwin-x64.tar.gz"),
    asset("fdev-linux-arm64.tar.gz"),
    asset("fdev-linux-x64.tar.gz"),
  ],
};

const checksums = [
  `${"a".repeat(64)}  fdev-darwin-arm64.tar.gz`,
  `${"b".repeat(64)}  fdev-darwin-x64.tar.gz`,
  `${"c".repeat(64)}  fdev-linux-arm64.tar.gz`,
  `${"d".repeat(64)}  fdev-linux-x64.tar.gz`,
].join("\n");

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("install worker", () => {
  test("serves latest release metadata from GitHub releases", async () => {
    mockGithubFetch();

    const response = await dispatch("https://fdev.freestyle.sh/latest.json");
    expect(response.status).toBe(200);

    const body = await response.json() as MetadataBody;
    expect(body.version).toBe("0.1.6");
    expect(body.tag).toBe("v0.1.6");
    expect(body.installerUrl).toBe("https://fdev.freestyle.sh/install");
    expect(body.downloads["darwin-arm64"]).toEqual({
      url: "https://fdev.freestyle.sh/download/v0.1.6/darwin-arm64",
      githubUrl: "https://github.com/freestyle-sh/fdev/releases/download/v0.1.6/fdev-darwin-arm64.tar.gz",
      sha256: "a".repeat(64),
    });
  });

  test("redirects latest downloads to the GitHub release asset", async () => {
    mockGithubFetch();

    const response = await dispatch("https://fdev.freestyle.sh/download/latest/darwin-arm64");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://github.com/freestyle-sh/fdev/releases/download/v0.1.6/fdev-darwin-arm64.tar.gz");
  });

  test("redirects versioned checksum requests to GitHub", async () => {
    mockGithubFetch();

    const response = await dispatch("https://fdev.freestyle.sh/checksums/v0.1.6");
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://github.com/freestyle-sh/fdev/releases/download/v0.1.6/checksums.txt");
  });

  test("serves an installer script that uses the worker endpoints", async () => {
    const response = await dispatch("https://fdev.freestyle.sh/install");
    expect(response.status).toBe(200);

    const body = await response.text();
    expect(body).toContain('base_url="${FDEV_BASE_URL:-https://fdev.freestyle.sh}"');
    expect(body).toContain('/download/latest/${target}');
    expect(body).toContain('/checksums/latest');
  });

  test("rejects unknown targets", async () => {
    mockGithubFetch();

    const response = await dispatch("https://fdev.freestyle.sh/download/latest/windows-x64");
    expect(response.status).toBe(400);
    expect(await response.json() as ErrorBody).toEqual({ error: "Unknown target windows-x64. Expected darwin-arm64, darwin-x64, linux-arm64, linux-x64." });
  });
});

function dispatch(url: string): Promise<Response> {
  return worker.fetch(new Request(url), {
    GITHUB_REPO: "freestyle-sh/fdev",
    PUBLIC_BASE_URL: "https://fdev.freestyle.sh",
    CACHE_TTL_SECONDS: "300",
  }, {
    waitUntil: () => undefined,
    passThroughOnException: () => undefined,
    props: undefined,
  } as ExecutionContext);
}

function mockGithubFetch(): void {
  globalThis.fetch = (async (input: URL | RequestInfo) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === "https://api.github.com/repos/freestyle-sh/fdev/releases/latest") {
      return Response.json(release);
    }
    if (url === "https://api.github.com/repos/freestyle-sh/fdev/releases/tags/v0.1.6") {
      return Response.json(release);
    }
    if (url === "https://github.com/freestyle-sh/fdev/releases/download/v0.1.6/checksums.txt") {
      return new Response(checksums, { headers: { "content-type": "text/plain" } });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

function asset(name: string): { name: string; browser_download_url: string } {
  return {
    name,
    browser_download_url: `https://github.com/freestyle-sh/fdev/releases/download/v0.1.6/${name}`,
  };
}
