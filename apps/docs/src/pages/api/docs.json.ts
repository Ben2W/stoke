import { getBundledDocs, sshTerminalConfig } from "@/lib/docs-bundle";
import { stripSearchIntentTags } from "@/lib/docs-search";
import { createDocsVirtualFiles } from "@/lib/docs-vfs";

export const prerender = true;

export async function GET() {
  const docs = await getBundledDocs();
  const publicDocs = docs.map(({ searchMarkdown: _searchMarkdown, source, ...doc }) => ({
    ...doc,
    source: stripSearchIntentTags(source),
  }));
  const generatedAt = new Date().toISOString();
  const virtualFiles = createDocsVirtualFiles(publicDocs, {
    generatedAt,
    terminalConfig: sshTerminalConfig,
    apiDocs: publicDocs,
  });

  return new Response(
    virtualFiles.apiDocsJson,
    {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=300, s-maxage=86400",
      },
    },
  );
}
