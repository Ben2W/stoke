import { getBundledDocs, renderSitemapText } from "@/lib/docs-bundle";

export const prerender = true;

export async function GET({ site }: { site?: URL }) {
  const docs = await getBundledDocs();
  return new Response(
    renderSitemapText(site ?? new URL("https://www.rigkit.dev"), docs),
    {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=300, s-maxage=86400",
      },
    },
  );
}
