import { getBundledDocs, renderSitemapXml } from "@/lib/docs-bundle";

export const prerender = true;

export async function GET({ site }: { site?: URL }) {
  const docs = await getBundledDocs();
  return new Response(
    renderSitemapXml(site ?? new URL("https://www.rigkit.dev"), docs),
    {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "public, max-age=300, s-maxage=86400",
      },
    },
  );
}
