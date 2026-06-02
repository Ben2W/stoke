import type { APIContext } from "astro";
import { getBundledDocs, renderLlmsFullText } from "@/lib/docs-bundle";

export const prerender = true;

export async function GET({ site }: APIContext) {
  const baseSite = site ?? new URL("https://www.rigkit.dev");
  const docs = await getBundledDocs();
  return new Response(renderLlmsFullText(baseSite, docs), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=86400",
    },
  });
}
