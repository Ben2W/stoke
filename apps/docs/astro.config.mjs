import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import { unified } from "@astrojs/markdown-remark";
import mdx from "@astrojs/mdx";

const hmrClientPort = process.env.DOCS_ASTRO_HMR_CLIENT_PORT
  ? Number(process.env.DOCS_ASTRO_HMR_CLIENT_PORT)
  : undefined;
const docsBasePath = (process.env.RIGKIT_DOCS_BASE_PATH ?? "/docs").replace(/\/+$/, "") || "/docs";

/**
 * Extract a tab/label from a code fence's meta string.
 * Supports `title="..."` and a bare leading token (e.g. ```bash pnpm).
 */
function parseCodeTitle(raw) {
  if (!raw) return undefined;
  const titled = raw.match(/title="([^"]+)"/);
  if (titled) return titled[1];
  const token = raw
    .trim()
    .split(/\s+/)
    .find((part) => part && !part.startsWith("{"));
  return token;
}

/**
 * Carry the fence meta onto the rendered <pre> so CodeGroup can build tabs,
 * and expose the language for copy buttons / fallback labels.
 */
const codeMetaTransformer = {
  name: "freestyle:code-meta",
  pre(node) {
    const title = parseCodeTitle(this.options.meta?.__raw);
    if (title) node.properties["data-code-title"] = title;
    if (this.options.lang) node.properties["data-code-lang"] = this.options.lang;
  },
};

function docsWebPath(pathname) {
  if (pathname === "/" || pathname === "") return docsBasePath;
  const absolutePath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  if (absolutePath === docsBasePath || absolutePath.startsWith(`${docsBasePath}/`)) {
    return absolutePath;
  }
  return `${docsBasePath}${absolutePath}`;
}

function prefixDocsMarkdownLinks() {
  return (tree) => {
    function visit(node) {
      if (!node || typeof node !== "object") return;

      if (
        (node.type === "link" || node.type === "definition") &&
        typeof node.url === "string" &&
        node.url.startsWith("/") &&
        !node.url.startsWith("//")
      ) {
        node.url = docsWebPath(node.url);
      }

      if (Array.isArray(node.children)) {
        for (const child of node.children) visit(child);
      }
    }

    visit(tree);
  };
}

export default defineConfig({
  site: process.env.SITE_URL ?? "https://www.rigkit.dev",
  base: docsBasePath,
  outDir: "./dist/docs",
  output: "static",
  adapter: cloudflare({
    imageService: "compile",
    prerenderEnvironment: "node",
  }),
  integrations: [mdx()],
  build: {
    format: "directory",
  },
  experimental: {
    advancedRouting: true,
  },
  markdown: {
    processor: unified({
      remarkPlugins: [prefixDocsMarkdownLinks],
    }),
    shikiConfig: {
      theme: "github-light",
      wrap: true,
      transformers: [codeMetaTransformer],
    },
  },
  vite: {
    server: hmrClientPort
      ? {
          hmr: {
            host: process.env.DOCS_ASTRO_HMR_HOST ?? "127.0.0.1",
            clientPort: hmrClientPort,
            protocol: "ws",
          },
        }
      : undefined,
    optimizeDeps: {
      exclude: ["@resvg/resvg-js"],
    },
    define: {
      "import.meta.env.PUBLIC_DOCS_BASE_PATH": JSON.stringify(docsBasePath),
    },
    ssr: {
      external: ["@resvg/resvg-js"],
    },
    resolve: {
      alias: {
        "@": new URL("./src", import.meta.url).pathname,
      },
    },
  },
});
