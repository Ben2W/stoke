import { getBundledDocs, sshTerminalConfig } from "@/lib/docs-bundle";
import { stripSearchIntentTags } from "@/lib/docs-search";

export const prerender = true;

export async function GET() {
  const docs = await getBundledDocs();
  const publicDocs = docs.map(({ searchMarkdown: _searchMarkdown, source, ...doc }) => ({
    ...doc,
    source: stripSearchIntentTags(source),
  }));
  return new Response(
    JSON.stringify(
      {
        docs: publicDocs,
        ssh: sshTerminalConfig,
        meta: {
          generatedAt: new Date().toISOString(),
        },
      },
      null,
      2,
    ),
    {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=300, s-maxage=86400",
      },
    },
  );
}
