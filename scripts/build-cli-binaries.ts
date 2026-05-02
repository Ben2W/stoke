import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";

const root = join(import.meta.dir, "..");
const outDir = join(root, "dist", "release");
const entrypoint = join(root, "packages", "fdev-cli", "src", "cli.ts");

const targets = [
  { target: "bun-darwin-arm64", name: "fdev-darwin-arm64" },
  { target: "bun-darwin-x64", name: "fdev-darwin-x64" },
  { target: "bun-linux-arm64", name: "fdev-linux-arm64" },
  { target: "bun-linux-x64-baseline", name: "fdev-linux-x64" },
];

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

for (const item of targets) {
  const outfile = join(outDir, item.name);
  await $`bun build --compile --compile-autoload-package-json --compile-autoload-tsconfig --target=${item.target} ${entrypoint} --outfile ${outfile}`;
  await $`chmod +x ${outfile}`;
  await $`tar -czf ${join(outDir, `${item.name}.tar.gz`)} -C ${outDir} ${item.name}`;
}

await $`sh -c "cd ${outDir} && shasum -a 256 *.tar.gz > checksums.txt"`;
console.log(`built fdev CLI binaries in ${outDir}`);
