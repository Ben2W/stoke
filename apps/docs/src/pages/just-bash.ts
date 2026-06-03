import { getBundledDocsVirtualFiles, renderBashDocs } from "@/lib/docs-bundle";

export const prerender = true;

export async function GET() {
  const virtualFiles = await getBundledDocsVirtualFiles();
  return new Response(renderBashDocs(virtualFiles), {
    headers: {
      "Content-Type": "text/x-shellscript; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=86400",
    },
  });
}
