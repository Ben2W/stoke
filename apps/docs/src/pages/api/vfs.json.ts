import { getBundledDocsVirtualFiles } from "@/lib/docs-bundle";
import { serializeDocsVirtualFileSystem } from "@/lib/docs-vfs";

export const prerender = true;

export async function GET() {
  const virtualFiles = await getBundledDocsVirtualFiles();

  return new Response(JSON.stringify(serializeDocsVirtualFileSystem(virtualFiles), null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=86400",
    },
  });
}
