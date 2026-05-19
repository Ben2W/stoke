import { getReleaseState } from "../release/lib";
import { assertDocsVersion } from "./lib";

function valueArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const version = valueArg("--version") ?? process.argv.slice(2).find((arg) =>
  arg !== "--" && !arg.startsWith("--")
) ?? getReleaseState().version;

assertDocsVersion(version);
console.log(`Docs version ${version.startsWith("v") ? version : `v${version}`} is ready`);
