import path from "node:path";
import {
  docsFigureNames,
  docsFigures,
  type DocsFigureName,
} from "@/lib/docs-figure-definitions";

export type DocsFigure = {
  name: DocsFigureName;
  src: string;
  alt: string;
  backgroundColor: string;
};

export type ResolvedDocsFigure = DocsFigure & {
  filePath: string;
  url: string;
};

const FIGURE_DIR = path.join(process.cwd(), "src/assets/docs/figures");

const figureUrls = import.meta.glob<string>(
  "/src/assets/docs/figures/*.{png,jpg,jpeg,webp,avif}",
  {
    eager: true,
    import: "default",
    query: "?url",
  },
);

const figureUrlByName = new Map(
  Object.entries(figureUrls).map(([filePath, url]) => [
    path.basename(filePath),
    url,
  ]),
);

export { docsFigureNames, docsFigures, type DocsFigureName };

function isDocsFigureName(name: string): name is DocsFigureName {
  return docsFigureNames.includes(name as DocsFigureName);
}

export function resolveDocsFigure(
  name: string,
  alt = name,
): ResolvedDocsFigure {
  if (!isDocsFigureName(name)) {
    throw new Error(`Unknown docs figure: ${name}`);
  }

  const figure = docsFigures[name];
  const filename = path.basename(figure.src);
  if (filename !== figure.src) {
    throw new Error(
      `Docs figure src must be a filename under src/assets/docs/figures: ${figure.src}`,
    );
  }

  const url = figureUrlByName.get(filename);
  if (!url) {
    throw new Error(`Missing docs figure asset: ${filename}`);
  }

  return {
    name,
    ...figure,
    alt,
    filePath: path.join(FIGURE_DIR, filename),
    url,
  };
}
