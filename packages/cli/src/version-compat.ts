import * as ui from "./ui.ts";

export type VersionCompatibilitySeverity = "ok" | "warning" | "error";

export type VersionCompatibilityIssue = {
  severity: Exclude<VersionCompatibilitySeverity, "ok">;
  subject: "cli-runtime" | "runtime-engine";
  message: string;
  recommendation: string;
};

export type VersionCompatibilityReport = {
  severity: VersionCompatibilitySeverity;
  cliVersion: string;
  runtimeVersion: string;
  engineVersion: string;
  issues: VersionCompatibilityIssue[];
};

type Semver = {
  major: number;
  minor: number;
  patch: number;
};

export function evaluateVersionCompatibility(input: {
  cliVersion: string;
  runtimeVersion: string;
  engineVersion: string;
}): VersionCompatibilityReport {
  const issues: VersionCompatibilityIssue[] = [
    compareCliRuntime(input.cliVersion, input.runtimeVersion),
    compareRuntimeEngine(input.runtimeVersion, input.engineVersion),
  ].filter((issue): issue is VersionCompatibilityIssue => Boolean(issue));

  return {
    ...input,
    severity: issues.some((issue) => issue.severity === "error")
      ? "error"
      : issues.some((issue) => issue.severity === "warning")
      ? "warning"
      : "ok",
    issues,
  };
}

export function renderVersionCompatibilityNotice(report: VersionCompatibilityReport): string {
  const heading = report.severity === "error"
    ? `${ui.err(ui.sym.err)} ${ui.bold("Rigkit version mismatch")}`
    : `${ui.warn("!")} ${ui.bold("Rigkit version mismatch")}`;
  const lines = [
    heading,
    `  ${ui.bold("global CLI")}       ${report.cliVersion}`,
    `  ${ui.bold("project runtime")}  ${report.runtimeVersion}`,
    `  ${ui.bold("project engine")}   ${report.engineVersion}`,
    ...report.issues.flatMap((issue) => [
      `  ${issue.severity === "error" ? ui.err("error") : ui.warn("warning")}  ${issue.message}`,
      `  ${ui.hint(issue.recommendation)}`,
    ]),
  ];
  return `${lines.join("\n")}\n`;
}

export function formatVersionCompatibilitySummary(report: VersionCompatibilityReport): string {
  if (report.severity === "ok") return "ok";
  return `${report.severity}: ${report.issues.map((issue) => issue.message).join("; ")}`;
}

function compareCliRuntime(cliVersion: string, runtimeVersion: string): VersionCompatibilityIssue | undefined {
  const cli = parseSemver(cliVersion);
  const runtime = parseSemver(runtimeVersion);
  if (!cli || !runtime) return undefined;
  if (cli.major !== runtime.major) {
    return {
      severity: "error",
      subject: "cli-runtime",
      message: `Global CLI ${cliVersion} and project runtime ${runtimeVersion} use different major versions.`,
      recommendation: cli.major < runtime.major
        ? "Update the global CLI with: curl -fsSL https://www.rigkit.dev/install | sh"
        : `Update project @rigkit/* packages to match CLI ${cliVersion}.`,
    };
  }
  if (cli.minor !== runtime.minor) {
    return {
      severity: "warning",
      subject: "cli-runtime",
      message: `Global CLI ${cliVersion} and project runtime ${runtimeVersion} use different minor versions.`,
      recommendation: cli.minor < runtime.minor
        ? "Update the global CLI with: curl -fsSL https://www.rigkit.dev/install | sh"
        : `Update project @rigkit/* packages to match CLI ${cliVersion}.`,
    };
  }
  return undefined;
}

function compareRuntimeEngine(runtimeVersion: string, engineVersion: string): VersionCompatibilityIssue | undefined {
  const runtime = parseSemver(runtimeVersion);
  const engine = parseSemver(engineVersion);
  if (!runtime || !engine) return undefined;
  if (runtime.major !== engine.major) {
    return {
      severity: "error",
      subject: "runtime-engine",
      message: `Project runtime ${runtimeVersion} and engine ${engineVersion} use different major versions.`,
      recommendation: "Install matching @rigkit/sdk and @rigkit/engine versions in the project.",
    };
  }
  if (runtime.minor !== engine.minor) {
    return {
      severity: "warning",
      subject: "runtime-engine",
      message: `Project runtime ${runtimeVersion} and engine ${engineVersion} use different minor versions.`,
      recommendation: "Install matching @rigkit/sdk and @rigkit/engine versions in the project.",
    };
  }
  return undefined;
}

function parseSemver(value: string): Semver | undefined {
  const match = value.trim().replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/);
  if (!match) return undefined;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}
