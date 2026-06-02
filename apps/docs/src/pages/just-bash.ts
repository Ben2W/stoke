import { getBundledDocs, renderBashDocs } from "@/lib/docs-bundle";

export const prerender = true;

export async function GET() {
  const docs = await getBundledDocs();
  return new Response(renderBashDocs(docs), {
    headers: {
      "Content-Type": "text/x-shellscript; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=86400",
    },
  });
}
