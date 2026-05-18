import { createDocsVersion } from "./lib";

function valueArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasArg(name: string): boolean {
  return process.argv.includes(name);
}

const version = valueArg("--version") ?? process.argv.slice(2).find((arg) =>
  arg !== "--" && !arg.startsWith("--")
);

if (!version) {
  throw new Error("Usage: pnpm docs:version -- --version <x.y.z> [--force]");
}

createDocsVersion(version, {
  force: hasArg("--force"),
});
