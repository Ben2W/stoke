#!/usr/bin/env bun
import { createDevMachineEngine } from "./engine.ts";
import type { DevMachineEvent } from "./types.ts";

type ParsedArgs = {
  command: string;
  positionals: string[];
  flags: Record<string, string | boolean>;
};

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2).filter((arg) => arg !== "--"));
  const projectDir = getStringFlag(args, "project") ?? getStringFlag(args, "cwd") ?? process.cwd();

  if (args.command === "help" || args.flags.help || args.flags.h) {
    printHelp(args.positionals[0]);
    return;
  }

  const engine = await createDevMachineEngine({ projectDir });
  engine.onEvent(renderEvent);
  await engine.load();

  switch (args.command) {
    case "plan": {
      const plan = await engine.plan({ machine: args.positionals[0] });
      console.log(JSON.stringify(plan, null, 2));
      return;
    }

    case "apply": {
      const result = await engine.apply({ machine: args.positionals[0] });
      const vmSuffix = result.vmId ? ` (${result.vmId})` : "";
      console.log(`resolved ${result.plan.machine} -> ${result.snapshotId ?? "no snapshot"}${vmSuffix}`);
      return;
    }

    case "fork": {
      const machine = args.positionals[0];
      const name = getStringFlag(args, "name") ?? args.positionals[1];
      if (!name) throw new Error(`fdev fork requires --name <workspace-name>`);

      const workspace = await engine.fork({ machine, name });
      console.log(`${workspace.name} ${workspace.vmId}`);
      return;
    }

    case "terminal": {
      const workspaceOrVmId = args.positionals[0];
      if (!workspaceOrVmId) throw new Error(`fdev terminal requires a workspace name or VM ID`);
      const printOnly = Boolean(args.flags.print || args.flags["print-only"]);
      const terminal = await engine.attachTerminal({ workspaceOrVmId, printOnly });
      if (printOnly) console.log(terminal.command);
      return;
    }

    case "snapshot": {
      const workspace = args.positionals[0];
      if (!workspace) throw new Error(`fdev snapshot requires a workspace name`);
      const label = getStringFlag(args, "label");
      const snapshot = await engine.snapshotWorkspace({ workspace, label });
      console.log(snapshot.snapshotId);
      return;
    }

    case "machines": {
      for (const machine of engine.listMachines()) {
        console.log(machine.name);
      }
      return;
    }

    default:
      if (!args.command) {
        printHelp();
        return;
      }
      throw new Error(`Unknown command ${args.command}. Run "fdev help" for usage.`);
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  let command = "";
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (!arg.startsWith("--")) {
      if (!command) {
        command = arg;
      } else {
        positionals.push(arg);
      }
      continue;
    }

    const raw = arg.slice(2);
    const equalsIndex = raw.indexOf("=");
    if (equalsIndex !== -1) {
      flags[raw.slice(0, equalsIndex)] = raw.slice(equalsIndex + 1);
      continue;
    }

    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      flags[raw] = next;
      index += 1;
      continue;
    }

    flags[raw] = true;
  }

  return { command: command || "help", positionals, flags };
}

function getStringFlag(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags[name];
  return typeof value === "string" ? value : undefined;
}

function renderEvent(event: DevMachineEvent): void {
  switch (event.type) {
    case "definition.loaded":
      console.error(`loaded ${event.machine}`);
      return;
    case "plan.created":
      console.error(`plan ${event.machine}: ${event.cachedPrefixLength}/${event.migrationCount} cached`);
      return;
    case "vm.created":
      console.error(event.fromSnapshotId ? `vm ${event.vmId} from ${event.fromSnapshotId}` : `vm ${event.vmId} created`);
      return;
    case "migration.started":
      console.error(`migration ${event.migration}`);
      return;
    case "step.started":
      console.error(`step ${event.step}`);
      return;
    case "step.output":
      process.stderr.write(event.data);
      return;
    case "step.completed":
      console.error(`step ${event.step} exited ${event.exitCode}`);
      return;
    case "interaction.awaiting_user":
      console.error(`interaction ${event.label}`);
      return;
    case "snapshot.created":
      console.error(`snapshot ${event.snapshotId}`);
      return;
    case "workspace.ready":
      console.error(`workspace ${event.workspaceId} -> ${event.vmId}`);
      return;
    default:
      return;
  }
}

function printHelp(command?: string): void {
  if (command && commandHelp[command]) {
    console.log(commandHelp[command]);
    return;
  }

  console.log(`fdev - Freestyle dev machine CLI

Commands:
  fdev machines
  fdev plan [machine]
  fdev apply [machine]
  fdev fork [machine] --name <workspace>
  fdev terminal <workspace-or-vm-id> [--print]
  fdev snapshot <workspace> [--label <label>]

Global options:
  --project <dir>       Directory containing freestyle.dev.ts
  --help, -h            Show help

Examples:
  fdev --project examples/smoke plan smoke
  fdev --project examples/smoke apply smoke
  fdev --project examples/smoke fork smoke --name smoke-1
  fdev --project examples/smoke terminal smoke-1 --print

Command help:
  fdev help plan
  fdev help apply
  fdev help fork
  fdev help terminal
`);
}

const commandHelp: Record<string, string> = {
  machines: `fdev machines

List machines exported by freestyle.dev.ts.

Usage:
  fdev machines [--project <dir>]
`,
  plan: `fdev plan [machine]

Load freestyle.dev.ts, compute migration keys, and show which migrations are cached or pending.

Usage:
  fdev plan [machine] [--project <dir>]
`,
  apply: `fdev apply [machine]

Resolve a dev machine by running missing migrations and snapshotting after each successful migration.

Usage:
  fdev apply [machine] [--project <dir>]
`,
  fork: `fdev fork <machine> --name <workspace>

Resolve a dev machine and create a workspace VM from its latest snapshot.

Usage:
  fdev fork <machine> --name <workspace> [--project <dir>]
`,
  terminal: `fdev terminal <workspace-or-vm-id>

Open SSH to a workspace or VM. Use --print to print the SSH command without executing it.

Usage:
  fdev terminal <workspace-or-vm-id> [--print] [--project <dir>]
`,
  snapshot: `fdev snapshot <workspace>

Create a snapshot from a workspace VM.

Usage:
  fdev snapshot <workspace> [--label <label>] [--project <dir>]
`,
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
