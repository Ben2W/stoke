import { getReleaseState } from "./lib";
import { syncPrepareReleaseWorkflowOptionsForVersion } from "./workflow-options";

const check = process.argv.includes("--check");
const version = getReleaseState().version;
const changed = syncPrepareReleaseWorkflowOptionsForVersion(version, { check });

if (changed.length === 0) {
  console.log("Prepare release workflow options are current.");
} else {
  console.log(`Updated prepare release workflow options: ${changed.join(", ")}`);
}
