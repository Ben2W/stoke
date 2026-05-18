import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { bumpVersion, root, type ReleaseType } from "./config";

type WorkflowOption = {
  releaseType: ReleaseType;
  path: string;
  version: string;
  description: string;
};

export function prepareReleaseWorkflowOptions(version: string): WorkflowOption[] {
  const patchVersion = bumpVersion(version, "patch");
  const minorVersion = bumpVersion(version, "minor");
  const majorVersion = bumpVersion(version, "major");

  return [
    {
      releaseType: "patch",
      path: ".github/workflows/prepare-patch-release.yml",
      version: patchVersion,
      description: `Prepare patch release ${patchVersion} from the matching version branch`,
    },
    {
      releaseType: "minor",
      path: ".github/workflows/prepare-minor-release.yml",
      version: minorVersion,
      description: `Prepare minor release ${minorVersion} from main`,
    },
    {
      releaseType: "major",
      path: ".github/workflows/prepare-major-release.yml",
      version: majorVersion,
      description: `Prepare major release ${majorVersion} from main`,
    },
  ];
}

export function syncPrepareReleaseWorkflowOptionsForVersion(
  version: string,
  options: { check?: boolean } = {},
) {
  const changed: string[] = [];

  for (const option of prepareReleaseWorkflowOptions(version)) {
    const absolute = join(root, option.path);
    const source = readFileSync(absolute, "utf8");
    const next = replaceWorkflowDispatch(source, option);

    if (next !== source) {
      changed.push(option.path);
      if (!options.check) {
        writeFileSync(absolute, next);
      }
    }
  }

  if (options.check && changed.length > 0) {
    throw new Error(
      `Prepare release workflow options are stale: ${changed.join(
        ", ",
      )}. Run pnpm release:update-workflows.`,
    );
  }

  return changed;
}

function replaceWorkflowDispatch(source: string, option: WorkflowOption) {
  const dispatchBlock = [
    "on:",
    "  workflow_dispatch:",
    "    inputs:",
    "      version:",
    `        description: "${option.description}"`,
    "        required: true",
    "        type: choice",
    "        options:",
    `          - "${option.version}"`,
  ].join("\n");

  const pattern = /on:\n  workflow_dispatch:[\s\S]*?\n\npermissions:/;
  if (!pattern.test(source)) {
    throw new Error(`Could not find workflow_dispatch block for ${option.path}`);
  }

  return source.replace(pattern, `${dispatchBlock}\n\npermissions:`);
}
