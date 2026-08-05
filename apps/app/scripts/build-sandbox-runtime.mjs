import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rootDir = resolve(appDir, "../..");
const outputDir = resolve(appDir, "public/runtime");

await mkdir(outputDir, { recursive: true });
await Promise.all([
  bundle("packages/cli/src/cli.ts", "stoke-cli.js"),
  bundle("packages/sdk/src/cli.ts", "stoke-runtime.js"),
]);

async function bundle(entryPoint, outputFile) {
  await build({
    absWorkingDir: rootDir,
    entryPoints: [entryPoint],
    outfile: resolve(outputDir, outputFile),
    bundle: true,
    format: "esm",
    platform: "node",
    target: "esnext",
    legalComments: "none",
  });
}
