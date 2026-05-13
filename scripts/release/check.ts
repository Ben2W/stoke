import { runReleaseCheck } from "./lib";

const tagArgIndex = process.argv.indexOf("--tag");
const tag =
  tagArgIndex >= 0 ? process.argv[tagArgIndex + 1] : process.env.GITHUB_REF_NAME;

runReleaseCheck(tag);
