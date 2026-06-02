import type { APIContext, GetStaticPaths } from "astro";
import type { CollectionEntry } from "astro:content";
import { docPathFromId, getDocsEntries, slugParamFromDoc } from "@/lib/docs";
import { docsWebPath } from "@/lib/docs-paths";

export const prerender = true;

export const getStaticPaths = (async () => {
  const entries = await getDocsEntries();
  return entries.map((entry) => ({
    params: { slug: slugParamFromDoc(entry) ?? "index" },
    props: { entry },
  }));
}) satisfies GetStaticPaths;

export async function GET({ props, site }: APIContext) {
  const [{ resolveDocsFigure }, { renderDocsOg }] = await Promise.all([
    import("@/lib/docs-figures"),
    import("@/lib/og/render"),
  ]);
  const { entry } = props as { entry: CollectionEntry<"docs"> };
  const path = docPathFromId(entry.id);
  const canonical = new URL(docsWebPath(path), site ?? "https://www.rigkit.dev");
  const png = await renderDocsOg({
    title: entry.data.title,
    description: entry.data.description,
    path,
    urlLabel: `${canonical.hostname}${canonical.pathname === "/" ? "" : canonical.pathname}`,
    figure: resolveDocsFigure(entry.data.figure, entry.data.title),
  });

  return new Response(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
