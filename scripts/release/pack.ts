import { join } from "node:path";
import { cleanDirectory, getReleaseState, run } from "./lib";
import { releasePackages, root } from "./config";

const outDir = join(root, "dist", "npm");
const state = getReleaseState();

cleanDirectory("dist/npm");

for (const pkg of releasePackages) {
  console.log(`Packing ${pkg.name}@${state.version}`);
  run(["pnpm", "-C", pkg.dir, "pack", "--pack-destination", outDir]);
}
