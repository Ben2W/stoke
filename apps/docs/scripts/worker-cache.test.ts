import { describe, expect, test } from "vitest";

import {
  cacheControlFor,
  canonicalDocsPathRedirect,
  cloudflareCacheControlFor,
  docsPath,
  isBashRequest,
  isSearchRequest,
  legacyDocsHostRedirect,
  legacyLookupPathname,
  redirectResponse,
  shouldReadWorkerCache,
  shouldWriteWorkerCache,
  withHeadBodyPolicy,
  withCacheHeaders,
  workerCacheKey,
} from "../src/worker";
import { getLegacyRedirect, LEGACY_REDIRECTS } from "../src/lib/legacy-redirects";
import {
  compactSearchText,
  extractSearchSections,
  prepareDocsSearchIndex,
  searchDocs,
} from "../src/lib/docs-search";

const docsCache =
  "public, max-age=300, s-maxage=86400, stale-while-revalidate=604800";
const htmlCache = "public, max-age=60, stale-while-revalidate=300";
const htmlEdgeCache = "public, max-age=300, stale-while-revalidate=60";
const immutableCache = "public, max-age=31536000, immutable";
const notFoundCache = "public, max-age=60, s-maxage=300";
const notFoundEdgeCache = "public, max-age=300";
const redirectCache = "public, max-age=60, s-maxage=300";
const redirectEdgeCache = "public, max-age=300";

function response(init?: ResponseInit) {
  return new Response("ok", init);
}

function assertResponse(value: Response | undefined) {
  if (!value) throw new Error("expected a redirect response");
  return value;
}

describe("Worker cache policy", () => {
  test("uses immutable caching for fingerprinted assets", () => {
    expect(cacheControlFor(new URL("https://docs.rigkit.dev/_astro/docs.abc.css"), response())).toBe(
      immutableCache,
    );
  });

  test("uses short caching for HTML and docs caching for machine-readable docs", () => {
    expect(
      cacheControlFor(
        new URL("https://www.rigkit.dev/docs/vms/ssh"),
        response({ headers: { "Content-Type": "text/html; charset=utf-8" } }),
      ),
    ).toBe(htmlCache);
    expect(cacheControlFor(new URL("https://www.rigkit.dev/docs/vms/ssh.md"), response())).toBe(
      docsCache,
    );
    expect(cacheControlFor(new URL("https://www.rigkit.dev/docs/api/docs.json"), response())).toBe(
      docsCache,
    );
    expect(cacheControlFor(new URL("https://www.rigkit.dev/docs/api/vfs.json"), response())).toBe(
      docsCache,
    );
    expect(cacheControlFor(new URL("https://www.rigkit.dev/docs/just-bash"), response())).toBe(
      docsCache,
    );
  });

  test("keeps 404s cacheable for a short period", () => {
    expect(cacheControlFor(new URL("https://docs.rigkit.dev/missing"), response({ status: 404 }))).toBe(
      notFoundCache,
    );
  });

  test("keeps redirects cacheable for only a short period", () => {
    expect(cacheControlFor(new URL("https://www.rigkit.dev/docs/vms"), response({ status: 307 }))).toBe(
      redirectCache,
    );
  });

  test("uses Cloudflare-specific edge cache headers", () => {
    expect(
      cloudflareCacheControlFor(
        new URL("https://docs.rigkit.dev/vms/ssh"),
        response({ headers: { "Content-Type": "text/html; charset=utf-8" } }),
      ),
    ).toBe(htmlEdgeCache);
    expect(
      cloudflareCacheControlFor(
        new URL("https://docs.rigkit.dev/missing"),
        response({ status: 404 }),
      ),
    ).toBe(notFoundEdgeCache);
    expect(
      cloudflareCacheControlFor(
        new URL("https://www.rigkit.dev/docs/vms"),
        response({ status: 307 }),
      ),
    ).toBe(redirectEdgeCache);
  });

  test("only stores cacheable request and response combinations", () => {
    expect(shouldReadWorkerCache(new Request("https://docs.rigkit.dev/"))).toBe(true);
    expect(shouldReadWorkerCache(new Request("https://docs.rigkit.dev/", { method: "HEAD" }))).toBe(
      true,
    );
    expect(shouldReadWorkerCache(new Request("https://docs.rigkit.dev/", { method: "POST" }))).toBe(
      false,
    );
    expect(
      shouldReadWorkerCache(
        new Request("https://docs.rigkit.dev/", {
          headers: { "Cache-Control": "no-cache" },
        }),
      ),
    ).toBe(false);
    expect(
      shouldReadWorkerCache(
        new Request("https://docs.rigkit.dev/", {
          headers: { Pragma: "no-cache" },
        }),
      ),
    ).toBe(false);
    expect(shouldWriteWorkerCache(new Request("https://docs.rigkit.dev/"))).toBe(true);
    expect(shouldWriteWorkerCache(new Request("https://docs.rigkit.dev/", { method: "HEAD" }))).toBe(
      false,
    );
    expect(
      shouldWriteWorkerCache(
        new Request("https://docs.rigkit.dev/", {
          headers: { "Cache-Control": "no-store" },
        }),
      ),
    ).toBe(false);
    expect(
      shouldWriteWorkerCache(
        new Request("https://docs.rigkit.dev/"),
        response({ status: 307 }),
      ),
    ).toBe(false);
    expect(
      shouldWriteWorkerCache(
        new Request("https://docs.rigkit.dev/"),
        response({ status: 500 }),
      ),
    ).toBe(false);
  });

  test("versions Worker cache keys to avoid stale response shapes", () => {
    const key = workerCacheKey(new URL("https://www.rigkit.dev/docs/vms?x=1"), "docs-abc1234");
    const keyUrl = new URL(key.url);

    expect(keyUrl.pathname).toBe("/docs/vms");
    expect(keyUrl.searchParams.get("x")).toBe("1");
    expect(keyUrl.searchParams.get("__freestyle_docs_cache")).toBe("docs-abc1234");
    expect(key.method).toBe("GET");
  });

  test("removes cached bodies from HEAD responses", async () => {
    const head = withHeadBodyPolicy(
      new Request("https://docs.rigkit.dev/", { method: "HEAD" }),
      new Response("body", { headers: { "X-Test": "ok" } }),
    );
    const get = withHeadBodyPolicy(
      new Request("https://docs.rigkit.dev/"),
      new Response("body", { headers: { "X-Test": "ok" } }),
    );

    expect(head.headers.get("X-Test")).toBe("ok");
    expect(await head.text()).toBe("");
    expect(await get.text()).toBe("body");
  });

  test("adds shared cache headers and cache status", () => {
    const cached = withCacheHeaders(
      new URL("https://docs.rigkit.dev/"),
      response({ headers: { "Content-Type": "text/html; charset=utf-8" } }),
      "MISS",
    );
    expect(cached.headers.get("Cache-Control")).toBe(htmlCache);
    expect(cached.headers.get("Cloudflare-CDN-Cache-Control")).toBe(htmlEdgeCache);
    expect(cached.headers.get("Cache-Tag")).toBe("freestyle-docs");
    expect(cached.headers.get("X-Freestyle-Docs-Cache")).toBe("MISS");
  });

  test("legacy redirects use short migration caches", () => {
    const redirected = redirectResponse(new URL("https://docs.rigkit.dev/introduction"), "/");
    expect(redirected.status).toBe(308);
    expect(redirected.headers.get("Location")).toBe("https://docs.rigkit.dev/");
    expect(redirected.headers.get("Cache-Control")).toBe(redirectCache);
    expect(redirected.headers.get("Cloudflare-CDN-Cache-Control")).toBe(redirectEdgeCache);
  });

  test("builds canonical docs paths", () => {
    expect(docsPath("/")).toBe("/docs");
    expect(docsPath("guides/quickstart")).toBe("/docs/guides/quickstart");
    expect(docsPath("/guides/quickstart")).toBe("/docs/guides/quickstart");
    expect(docsPath("/docs/guides/quickstart")).toBe("/docs/guides/quickstart");
  });

  test("normalizes docs mount paths only for legacy redirect lookup", () => {
    expect(legacyLookupPathname("/docs")).toBe("/");
    expect(legacyLookupPathname("/docs/introduction")).toBe("/introduction");
    expect(legacyLookupPathname("/docs/guides/quickstart")).toBe("/guides/quickstart");
    expect(legacyLookupPathname("/pricing")).toBe("/pricing");
  });

  test("permanently canonicalizes docs index and trailing-slash paths", () => {
    const trailingSlash = assertResponse(
      canonicalDocsPathRedirect(new URL("https://www.rigkit.dev/docs/guides/quickstart/?x=1")),
    );
    const indexHtml = assertResponse(
      canonicalDocsPathRedirect(new URL("https://www.rigkit.dev/docs/guides/quickstart/index.html?x=1")),
    );
    const docsIndex = assertResponse(
      canonicalDocsPathRedirect(new URL("https://www.rigkit.dev/docs/index.html")),
    );

    expect(trailingSlash.status).toBe(308);
    expect(trailingSlash.headers.get("Location")).toBe("/docs/guides/quickstart?x=1");
    expect(indexHtml.status).toBe(308);
    expect(indexHtml.headers.get("Location")).toBe("/docs/guides/quickstart?x=1");
    expect(docsIndex.status).toBe(308);
    expect(docsIndex.headers.get("Location")).toBe("/docs");
    expect(
      canonicalDocsPathRedirect(new URL("https://www.rigkit.dev/docs/guides/quickstart")),
    ).toBeUndefined();
  });

  test("redirects the old docs host to the canonical docs path", () => {
    const redirected = assertResponse(
      legacyDocsHostRedirect(new URL("https://docs.rigkit.dev/guides/quickstart?from=old")),
    );
    expect(redirected.status).toBe(308);
    expect(redirected.headers.get("Location")).toBe(
      "https://www.rigkit.dev/docs/guides/quickstart?from=old",
    );
    expect(redirected.headers.get("Cache-Control")).toBe(redirectCache);
  });

  test("applies legacy path redirects when leaving the old docs host", () => {
    const redirected = assertResponse(
      legacyDocsHostRedirect(new URL("https://docs.rigkit.dev/introduction?from=old")),
    );
    expect(redirected.status).toBe(308);
    expect(redirected.headers.get("Location")).toBe(
      "https://www.rigkit.dev/docs?from=old",
    );
  });

  test("redirects the apex docs route to the canonical www docs path", () => {
    const redirected = assertResponse(
      legacyDocsHostRedirect(new URL("https://rigkit.dev/docs/guides/quickstart?from=apex")),
    );
    expect(redirected.status).toBe(308);
    expect(redirected.headers.get("Location")).toBe(
      "https://www.rigkit.dev/docs/guides/quickstart?from=apex",
    );
    expect(redirected.headers.get("Cache-Control")).toBe(redirectCache);
  });

  test("applies legacy path redirects from the apex docs route", () => {
    const redirected = assertResponse(
      legacyDocsHostRedirect(new URL("https://rigkit.dev/docs/introduction")),
    );
    expect(redirected.status).toBe(308);
    expect(redirected.headers.get("Location")).toBe("https://www.rigkit.dev/docs");
  });

  test("does not redirect the canonical www docs host", () => {
    expect(
      legacyDocsHostRedirect(new URL("https://www.rigkit.dev/docs/guides/quickstart")),
    ).toBeUndefined();
  });

  test("does not redirect Wrangler local route simulations", () => {
    expect(legacyDocsHostRedirect(new URL("http://rigkit.dev:8788/docs"))).toBeUndefined();
  });

  test("preserves every legacy Mintlify redirect", () => {
    for (const [source, destination] of LEGACY_REDIRECTS) {
      expect(getLegacyRedirect(source), source).toBe(destination);
      expect(getLegacyRedirect(`${source}/`), `${source}/`).toBe(destination);
    }
  });

  test("preserves legacy markdown redirects", () => {
    for (const [source, destination] of LEGACY_REDIRECTS) {
      const markdownDestination = destination === "/" ? "/index.md" : `${destination}.md`;
      expect(getLegacyRedirect(`${source}.md`), `${source}.md`).toBe(markdownDestination);
      expect(getLegacyRedirect(`${source}.md/`), `${source}.md/`).toBe(markdownDestination);
    }
  });

  test("does not redirect unknown legacy-looking paths", () => {
    expect(getLegacyRedirect("/v2/not-real")).toBeUndefined();
    expect(getLegacyRedirect("/git/repositories")).toBeUndefined();
  });
});

describe("docs search", () => {
  test("requires SearchIntent before indexable h2 sections", () => {
    expect(() =>
      extractSearchSections("## Missing Intent\n\nText.", { source: "missing.mdx" }),
    ).toThrow("missing.mdx:1: Missing SearchIntent before section heading: Missing Intent");

    expect(
      extractSearchSections("<SearchIntent auto />\n\n## Has Intent\n\nText.", {
        source: "present.mdx",
      }),
    ).toMatchObject([
      {
        title: "Has Intent",
        searchIntent: { mode: "auto" },
      },
    ]);
  });

  test("matches full body text and returns a body snippet", () => {
    const index = prepareDocsSearchIndex([
      {
        id: "vms/ssh",
        path: "/docs/vms/ssh",
        title: "SSH Access",
        description: "Connect to Freestyle VMs over SSH.",
        body: compactSearchText(
          "Create a scoped token before connecting. The token controls VM access.",
        ),
      },
      {
        id: "git/repositories",
        path: "/docs/git/repositories",
        title: "Repositories",
        description: "Create hosted Git repositories.",
        body: compactSearchText("Repositories store code for users and agents."),
      },
    ]);

    const payload = searchDocs(index, "scoped token");

    expect(payload.results).toHaveLength(1);
    expect(payload.results[0]?.path).toBe("/docs/vms/ssh");
    expect(payload.results[0]?.snippet).toContain("scoped token");
    expect(payload.results[0]?.previewMarkdown).toContain("scoped token");
    expect(payload.results[0]?.previewMarkdown).not.toContain("==scoped==");
    expect(payload.results[0]?.highlightTerms).toEqual(["scoped", "token"]);
    expect(payload.results[0]).not.toHaveProperty("snippetHtml");
  });

  test("keeps stopwords and single-character query terms available for highlighting", () => {
    const index = prepareDocsSearchIndex([
      {
        id: "vms",
        path: "/docs/vms",
        title: "Freestyle VMs",
        description: "Create and control VMs.",
        body: compactSearchText("Create a VM. Create or import code."),
        sections: [
          {
            title: "Create A VM",
            anchor: "create-a-vm",
            blocks: [{ kind: "text", text: "Create a VM." }],
          },
          {
            title: "Clone A Repository",
            anchor: "clone-a-repository",
            blocks: [{ kind: "text", text: "Create or import code into Git." }],
          },
        ],
      },
    ]);

    expect(searchDocs(index, "create a vm").results[0]).toMatchObject({
      highlightTerms: ["create", "vm"],
      highlightPhraseTerms: ["create", "a", "vm"],
    });
    expect(searchDocs(index, "create or import code").results[0]).toMatchObject({
      highlightTerms: ["create", "import", "code"],
      highlightPhraseTerms: ["create", "or", "import", "code"],
    });
  });

  test("weights title matches above body-only matches", () => {
    const index = prepareDocsSearchIndex([
      {
        id: "body",
        path: "/docs/body",
        title: "Generic Page",
        description: "A generic page.",
        body: compactSearchText("Git search appears in the body many times. Git search."),
      },
      {
        id: "git/search",
        path: "/docs/git/search",
        title: "Git Search",
        description: "Search repository contents.",
        body: compactSearchText("Find code without cloning a repository."),
      },
    ]);

    const payload = searchDocs(index, "git search");

    expect(payload.results[0]?.path).toBe("/docs/git/search");
  });

  test("uses explicit SearchIntent aliases for product-level short queries", () => {
    const index = prepareDocsSearchIndex([
      {
        id: "git",
        path: "/docs/git",
        title: "Freestyle Git",
        description: "Create and manage Git repositories.",
        body: compactSearchText("Create a repository and clone it with native Git."),
        sections: [
          {
            title: "Create A Repository",
            anchor: "create-a-repository",
            searchIntent: { mode: "intent", id: "git.createRepository" },
            blocks: [
              {
                kind: "code",
                language: "ts",
                text: "const { repo } = await freestyle.git.repos.create();",
              },
            ],
          },
          {
            title: "Clone A Repository",
            anchor: "clone-a-repository",
            searchIntent: { mode: "intent", id: "git.cloneRepository" },
            blocks: [
              {
                kind: "code",
                language: "bash",
                text: "git clone https://git.freestyle.sh/<repo-id>",
              },
            ],
          },
        ],
      },
      {
        id: "git/cli",
        path: "/docs/git/cli",
        title: "Git CLI",
        description: "Use native Git and the Freestyle CLI.",
        body: compactSearchText("git clone git push"),
      },
    ]);

    const payload = searchDocs(index, "git");

    expect(payload.results[0]?.path).toBe("/docs/git#create-a-repository");
  });

  test("falls back to fuzzy matching for typos", () => {
    const index = prepareDocsSearchIndex([
      {
        id: "git",
        path: "/docs/git",
        title: "Freestyle Git",
        description: "Create and manage Git repositories.",
        body: compactSearchText("Create a repository."),
        sections: [
          {
            title: "Create A Repository",
            anchor: "create-a-repository",
            searchIntent: { mode: "intent", id: "git.createRepository" },
            blocks: [{ kind: "text", text: "Create a Freestyle Git repository." }],
          },
        ],
      },
    ]);

    const payload = searchDocs(index, "gti");

    expect(payload.results[0]?.path).toBe("/docs/git#create-a-repository");
  });

  test("does not let long identifiers collapse into unrelated short prefix matches", () => {
    const index = prepareDocsSearchIndex([
      {
        id: "generic/path",
        path: "/docs/generic/path",
        title: "Config Paths",
        description: "Use a system config path.",
        body: compactSearchText("Use a path for repeated local testing."),
      },
      {
        id: "git/search",
        path: "/docs/git/search",
        title: "Git Search",
        description: "Search repository contents.",
        body: 'repo.search({ query: "TODO", pathPattern: "src/**/*.ts" })',
        sections: [
          {
            title: "Content Search",
            anchor: "content-search",
            searchIntent: { mode: "intent", id: "git.searchCode" },
            blocks: [
              {
                kind: "code",
                language: "ts",
                text: 'repo.search({ query: "TODO", pathPattern: "src/**/*.ts" })',
              },
            ],
          },
        ],
      },
    ]);

    const payload = searchDocs(index, "pathPattern");

    expect(payload.results[0]?.path).toBe("/docs/git/search#content-search");
  });

  test("prefers the prose block that contains a natural-language query phrase", () => {
    const index = prepareDocsSearchIndex([
      {
        id: "git",
        path: "/docs/git",
        title: "Freestyle Git",
        description: "Create and manage repositories for user-generated code.",
        body: compactSearchText("import { freestyle } from 'freestyle'; create code"),
        sections: [
          {
            title: "Create A Repository",
            anchor: "create-a-repository",
            searchIntent: { mode: "intent", id: "git.createRepository" },
            blocks: [
              {
                kind: "code",
                language: "ts",
                text: "import { freestyle } from 'freestyle';\nfreestyle.git.repos.create();",
              },
            ],
          },
        ],
      },
      {
        id: "vms",
        path: "/docs/vms",
        title: "Freestyle VMs",
        description: "Create and control Linux virtual machines.",
        body: compactSearchText(
          "VMs work well with Freestyle Git repositories. Create or import code into Git.",
        ),
        sections: [
          {
            title: "Clone A Repository",
            anchor: "clone-a-repository",
            searchIntent: { mode: "intent", id: "vms.cloneRepository" },
            blocks: [
              {
                kind: "text",
                text: "VMs work well with Freestyle Git repositories. Create or import code into Git, grant the VM access through your application, then clone and run it inside the VM.",
                markdown:
                  "VMs work well with [Freestyle Git](/git) repositories. Create or import code into Git, grant the VM access through your application, then clone and run it inside the VM.",
              },
            ],
          },
        ],
      },
    ]);

    const payload = searchDocs(index, "Create or import code");
    const result = payload.results[0];

    expect(result?.path).toBe("/docs/vms#clone-a-repository");
    expect(result?.snippet).toContain("Create or import code into Git");
    expect(result?.previewMarkdown).toContain("Create or import code into Git");
    expect(result?.previewKind).toBe("text");
  });

  test("renders controlled code block snippets for code matches", () => {
    const index = prepareDocsSearchIndex([
      {
        id: "git/search",
        path: "/docs/git/search",
        title: "Git Search",
        description: "Search repository contents.",
        body: 'repo.search({ query: "TODO", pathPattern: "src/**/*.ts" })',
        sections: [
          {
            title: "Content Search",
            anchor: "content-search",
            blocks: [
              {
                kind: "code",
                language: "ts",
                text: 'repo.search({ query: "TODO", pathPattern: "src/**/*.ts" })',
              },
            ],
          },
        ],
      },
    ]);

    const payload = searchDocs(index, "pathPattern");
    const result = payload.results[0];
    const previewMarkdown = result?.previewMarkdown ?? "";

    expect(result?.path).toBe("/docs/git/search#content-search");
    expect(result?.sectionTitle).toBe("Content Search");
    expect(result?.previewKind).toBe("code");
    expect(result?.previewLanguage).toBe("ts");
    expect(result?.highlightTerms).toEqual(["pathpattern"]);
    expect(previewMarkdown).toContain("```ts");
    expect(previewMarkdown).toContain("pathPattern");
    expect(previewMarkdown).toContain('"src/**/*.ts"');
    expect(previewMarkdown).not.toContain("==pathPattern==");
    expect(previewMarkdown).not.toContain("<code>");
    expect(result).not.toHaveProperty("snippetKind");
  });

  test("recognizes the Worker search route under the docs prefix", () => {
    expect(isSearchRequest(new URL("https://www.rigkit.dev/docs/api/search?q=ssh"))).toBe(
      true,
    );
    expect(isSearchRequest(new URL("https://www.rigkit.dev/docs/api/docs.json"))).toBe(false);
  });

  test("recognizes the Worker just-bash route under the docs prefix", () => {
    expect(isBashRequest(new URL("https://www.rigkit.dev/docs/bash"))).toBe(true);
    expect(isBashRequest(new URL("https://www.rigkit.dev/docs/just-bash"))).toBe(false);
  });
});
