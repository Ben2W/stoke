import fs from "node:fs/promises";
import path from "node:path";
import satori from "satori";
import { loadFonts } from "@/lib/og/fonts";
import { DocsOgTemplate, type DocsOgProps } from "@/lib/og/template";

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

function mimeTypeForPath(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".svg") return "image/svg+xml";
  return "image/png";
}

async function imageDataUri(filePath: string) {
  const data = await fs.readFile(filePath);
  return `data:${mimeTypeForPath(filePath)};base64,${data.toString("base64")}`;
}

export async function renderDocsOg(props: DocsOgProps) {
  const { Resvg } = await import("@resvg/resvg-js");
  const svg = await satori(
    <DocsOgTemplate
      {...props}
      figureDataUri={await imageDataUri(props.figure.filePath)}
    />,
    {
      width: OG_WIDTH,
      height: OG_HEIGHT,
      fonts: await loadFonts(),
    },
  );

  return new Resvg(svg, {
    fitTo: { mode: "width", value: OG_WIDTH },
  })
    .render()
    .asPng();
}
