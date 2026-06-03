import { docsWebPath } from "./docs-paths";

export type DocsVirtualFileSource = {
  path: string;
  markdownPath?: string;
  title: string;
  description: string;
  markdown: string;
};

export type DocsTerminalConfig = {
  promptHost: string;
  banner: string;
  title: string;
  hint: string;
};

export type DocsVirtualFile = {
  path: string;
  body: string;
};

export type DocsVirtualFileSystem = {
  docs: DocsVirtualFileSource[];
  generatedAt: string;
  terminalConfig: DocsTerminalConfig;
  files: Record<string, string>;
  docFiles: DocsVirtualFile[];
  machineFiles: DocsVirtualFile[];
  codebaseFiles: DocsVirtualFile[];
  apiDocsJson: string;
};

export type DocsVirtualFileSystemPayload = {
  ssh: DocsTerminalConfig;
  meta: {
    generatedAt: string;
    fileCount: number;
    docFileCount: number;
    machineFileCount: number;
    codebaseFileCount: number;
    codebaseRoot: string;
  };
  files: Record<string, string>;
  docFiles: DocsVirtualFile[];
  machineFiles: DocsVirtualFile[];
  codebaseFiles: DocsVirtualFile[];
};

export const DEFAULT_DOCS_SITE = new URL("https://www.rigkit.dev");
export const RIGKIT_CODEBASE_ROOT = "/rigkit";

function resolveMarkdownLink(url: string, pagePath: string, site: URL): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
  if (url.startsWith("//")) return `${site.protocol}${url}`;
  if (url.startsWith("#")) return url;
  if (url.startsWith("/")) return new URL(docsWebPath(url), site).toString();
  return new URL(url, new URL(pagePath, site)).toString();
}

export function absolutizeMarkdownLinks(
  markdown: string,
  pagePath: string,
  site: URL,
): string {
  return markdown.replace(
    /(!?\[[^\]]*\])\(([^)\s]+)((?:\s+"[^"]*")?)\)/g,
    (_match, label: string, url: string, title: string) =>
      `${label}(${resolveMarkdownLink(url, pagePath, site)}${title})`,
  );
}

export function renderLlmsText(docs: DocsVirtualFileSource[]) {
  const lines = [
    "# Rigkit Docs",
    "",
    "Documentation for Rigkit declarative dev environments.",
    "",
    "## Pages",
    "",
  ];

  for (const doc of docs) {
    lines.push(`- [${doc.title}](${docsWebPath(doc.path)}): ${doc.description}`);
  }

  lines.push("", "## Markdown", "");

  for (const doc of docs) {
    lines.push(`- [${doc.title}](${docsWebPath(doc.markdownPath ?? markdownPathForDoc(doc))})`);
  }

  return `${lines.join("\n")}\n`;
}

export function renderLlmsFullText(site: URL, docs: DocsVirtualFileSource[]) {
  const sections = [
    "# Rigkit Docs",
    "",
    "Documentation for Rigkit declarative dev environments.",
    "",
    "Each section below is a single docs page. The `Source:` line is the canonical URL of the page.",
  ];

  for (const doc of docs) {
    const pagePath = docsWebPath(doc.path);
    const pageUrl = new URL(pagePath, site).toString();
    const absoluteMarkdown = absolutizeMarkdownLinks(doc.markdown, pagePath, site);
    sections.push(
      "",
      "---",
      "",
      `# ${doc.title}`,
      "",
      `Source: ${pageUrl}`,
      "",
      doc.description,
      "",
      absoluteMarkdown.trimEnd(),
    );
  }

  return `${sections.join("\n")}\n`;
}

export function virtualFilePath(doc: DocsVirtualFileSource, allPaths: string[]) {
  const mountedPath = doc.path === "/" ? "/docs" : `/docs${doc.path}`;
  if (doc.path === "/") return "/docs/index.md";

  const hasChildren = allPaths.some((path) => path.startsWith(`${doc.path}/`));
  return hasChildren ? `${mountedPath}/index.md` : `${mountedPath}.md`;
}

export function createDocsVirtualFiles(
  docs: DocsVirtualFileSource[],
  {
    generatedAt,
    site = DEFAULT_DOCS_SITE,
    terminalConfig,
    apiDocs = docs,
    codebaseFiles = [],
  }: {
    generatedAt: string;
    site?: URL;
    terminalConfig: DocsTerminalConfig;
    apiDocs?: unknown;
    codebaseFiles?: DocsVirtualFile[];
  },
): DocsVirtualFileSystem {
  const allPaths = docs.map((doc) => doc.path);
  const docFiles = docs.map((doc) => ({
    path: virtualFilePath(doc, allPaths),
    body: doc.markdown,
  }));
  const apiDocsJson = JSON.stringify(
    {
      docs: apiDocs,
      ssh: terminalConfig,
      meta: { generatedAt },
    },
    null,
    2,
  );
  const machineFiles = [
    { path: "/README.md", body: renderRootReadme() },
    { path: "/llms.txt", body: renderLlmsText(docs) },
    { path: "/llms-full.txt", body: renderLlmsFullText(site, docs) },
    { path: "/api/docs.json", body: apiDocsJson },
  ];
  const files = Object.fromEntries(
    [...docFiles, ...machineFiles, ...codebaseFiles].map((file) => [file.path, file.body]),
  );

  return {
    docs,
    generatedAt,
    terminalConfig,
    files,
    docFiles,
    machineFiles,
    codebaseFiles,
    apiDocsJson,
  };
}

export function serializeDocsVirtualFileSystem(
  virtualFiles: DocsVirtualFileSystem,
): DocsVirtualFileSystemPayload {
  return {
    ssh: virtualFiles.terminalConfig,
    meta: {
      generatedAt: virtualFiles.generatedAt,
      fileCount: Object.keys(virtualFiles.files).length,
      docFileCount: virtualFiles.docFiles.length,
      machineFileCount: virtualFiles.machineFiles.length,
      codebaseFileCount: virtualFiles.codebaseFiles.length,
      codebaseRoot: RIGKIT_CODEBASE_ROOT,
    },
    files: virtualFiles.files,
    docFiles: virtualFiles.docFiles,
    machineFiles: virtualFiles.machineFiles,
    codebaseFiles: virtualFiles.codebaseFiles,
  };
}

function markdownPathForDoc(doc: DocsVirtualFileSource) {
  return doc.path === "/" ? "/index.md" : `${doc.path}.md`;
}

function renderRootReadme() {
  return [
    "# Rigkit Docs shell",
    "",
    "This shell exposes the Rigkit docs and source code as a small virtual filesystem for humans, CLIs, and AI agents.",
    "",
    "Rigkit runs declarative dev environments from a TypeScript config, then creates named workspaces for agents, developers, CI jobs, and tests.",
    "",
    "## Start Here",
    "",
    "- Web docs: https://www.rigkit.dev/docs",
    "- LLM index: https://www.rigkit.dev/docs/llms.txt",
    "- Full LLM context: https://www.rigkit.dev/docs/llms-full.txt",
    "- SSH docs root: /docs",
    "- Source code root: /rigkit",
    "",
    "## Useful Commands",
    "",
    "```text",
    "ls /",
    "ls /docs",
    "ls /rigkit",
    "cat /docs/guides/quickstart.md",
    "cat /rigkit/package.json",
    "grep \"createDocsVirtualFiles\" /rigkit/apps/docs/src/lib/docs-vfs.ts",
    "search workspace",
    "grep \"workflow\" /docs/guides --json",
    "context --json provider",
    "cat /llms.txt",
    "cat /llms-full.txt",
    "cat /api/docs.json",
    "```",
    "",
    "Tab completes commands and paths in interactive sessions.",
    "",
  ].join("\n");
}
