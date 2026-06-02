import type { APIContext, GetStaticPaths } from "astro";
import { docPathFromId, getDocsEntries, slugParamFromDoc } from "@/lib/docs";
import { absolutizeMarkdownLinks, getBundledDocById } from "@/lib/docs-bundle";
import { docsWebPath } from "@/lib/docs-paths";

export const prerender = true;

export const getStaticPaths = (async () => {
  const entries = await getDocsEntries();
  return entries.map((entry) => ({
    params: { slug: slugParamFromDoc(entry) ?? "index" },
    props: { id: entry.id },
  }));
}) satisfies GetStaticPaths;

export async function GET({ props, site }: APIContext) {
  const { id } = props as { id: string };
  const doc = await getBundledDocById(id);

  if (!doc) {
    return new Response("Not found\n", { status: 404 });
  }

  const canonicalPath = docPathFromId(id);
  const baseSite = site ?? new URL("https://www.rigkit.dev");
  const markdown = absolutizeMarkdownLinks(doc.markdown, docsWebPath(canonicalPath), baseSite);
  const body = `---
title: ${JSON.stringify(doc.title)}
description: ${JSON.stringify(doc.description)}
url: ${JSON.stringify(docsWebPath(canonicalPath))}
---

${markdown}`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=86400",
    },
  });
}
