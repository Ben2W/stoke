import { getBundledDocs } from "@/lib/docs-bundle";
import {
  compactSearchText,
  extractSearchSections,
  type DocsSearchDocument,
} from "@/lib/docs-search";
import { docsWebPath } from "@/lib/docs-paths";

export const prerender = true;

export async function GET() {
  const docs = await getBundledDocs();
  // getBundledDocs returns docs in navigation order, so the array index doubles
  // as each page's importance rank for the search ranker.
  const index: DocsSearchDocument[] = docs.map((doc, order) => ({
    id: doc.id,
    path: docsWebPath(doc.path),
    title: doc.title,
    description: doc.description,
    body: compactSearchText(doc.searchMarkdown),
    order,
    sections: extractSearchSections(doc.searchMarkdown, {
      source: doc.id,
      validateSearchIntents: false,
    }),
  }));

  return new Response(JSON.stringify(index), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=86400",
    },
  });
}
