import { appendFileSync } from "node:fs";

function valueArg(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const sha = valueArg("--sha");
if (!sha) {
  throw new Error("Usage: bun scripts/release/canary-main-version.ts --sha <sha>");
}

const shortSha = sha.replace(/[^0-9A-Za-z]/g, "").slice(0, 7);
if (shortSha.length === 0) {
  throw new Error(`Could not derive short sha from ${sha}`);
}

const now = new Date();
const stamp = [
  now.getUTCFullYear(),
  String(now.getUTCMonth() + 1).padStart(2, "0"),
  String(now.getUTCDate()).padStart(2, "0"),
  "T",
  String(now.getUTCHours()).padStart(2, "0"),
  String(now.getUTCMinutes()).padStart(2, "0"),
  String(now.getUTCSeconds()).padStart(2, "0"),
].join("");

const version = `0.0.0-canary-${stamp}-${shortSha}`;

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\n`);
}

console.log(version);
