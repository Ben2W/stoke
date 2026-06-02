import { docsWebPath } from "@/lib/docs-paths";

export const prerender = true;

export async function GET({ site }: { site?: URL }) {
  const base = site ?? new URL("https://www.rigkit.dev");
  return new Response(
    `User-agent: *
Allow: /

Sitemap: ${new URL(docsWebPath("/sitemap.xml"), base).toString()}
`,
    {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=300, s-maxage=86400",
      },
    },
  );
}
