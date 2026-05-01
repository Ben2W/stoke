#!/usr/bin/env bun
import { createDevMachineEngine } from "./engine.ts";
import type { DevMachineEvent } from "./types.ts";

type ParsedArgs = {
  command: string;
  positionals: string[];
  flags: Record<string, string | boolean>;
};

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.command === "help" || args.flags.help || args.flags.h) {
    printHelp();
    return;
  }

  const engine = await createDevMachineEngine({ projectDir: process.cwd() });
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
      throw new Error(`Unknown command ${args.command}`);
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command = "help", ...rest] = argv;
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }

    const raw = arg.slice(2);
    const equalsIndex = raw.indexOf("=");
    if (equalsIndex !== -1) {
      flags[raw.slice(0, equalsIndex)] = raw.slice(equalsIndex + 1);
      continue;
    }

    const next = rest[index + 1];
    if (next && !next.startsWith("--")) {
      flags[raw] = next;
      index += 1;
      continue;
    }

    flags[raw] = true;
  }

  return { command, positionals, flags };
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

function printHelp(): void {
  console.log(`fdev

Commands:
  fdev machines
  fdev plan [machine]
  fdev apply [machine]
  fdev fork [machine] --name <workspace>
  fdev terminal <workspace-or-vm-id> [--print]
  fdev snapshot <workspace> [--label <label>]
`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
