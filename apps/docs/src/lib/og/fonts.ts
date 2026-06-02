import fs from "node:fs/promises";
import path from "node:path";

const PROJECT_ROOT = process.cwd();
const FONT_DIR = path.join(PROJECT_ROOT, "src/lib/og/fonts");

export type SatoriFont = {
  name: string;
  data: Buffer;
  weight: 400 | 600 | 700;
  style: "normal";
};

let cachedFonts: SatoriFont[] | null = null;

export async function loadFonts() {
  if (cachedFonts) return cachedFonts;

  const [regular, semibold, bold, monoRegular, monoBold] = await Promise.all([
    fs.readFile(path.join(FONT_DIR, "Inter-Regular.otf")),
    fs.readFile(path.join(FONT_DIR, "Inter-SemiBold.otf")),
    fs.readFile(path.join(FONT_DIR, "Inter-Bold.otf")),
    fs.readFile(path.join(FONT_DIR, "JetBrainsMono-Regular.ttf")),
    fs.readFile(path.join(FONT_DIR, "JetBrainsMono-Bold.ttf")),
  ]);

  cachedFonts = [
    { name: "Inter", data: regular, weight: 400, style: "normal" },
    { name: "Inter", data: semibold, weight: 600, style: "normal" },
    { name: "Inter", data: bold, weight: 700, style: "normal" },
    { name: "JetBrains Mono", data: monoRegular, weight: 400, style: "normal" },
    { name: "JetBrains Mono", data: monoBold, weight: 700, style: "normal" },
  ];

  return cachedFonts;
}
