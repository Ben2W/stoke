// Append-only run presenter. Each runtime event prints zero or one line to
// stderr. No spinners, no re-renders. Looks the same in a TTY, a CI log, and an
// LLM transcript — and it pipes cleanly.

import { accent, bold, clip, dim, err, ok, sym, termWidth } from "./ui.ts";

export type RunPresenter = {
  render(event: { type: string; [key: string]: unknown }): void;
  pause(): void;
  resume(): void;
  close(): void;
};

export function createRunPresenter(operation: string): RunPresenter | undefined {
  if (process.env.RIGKIT_RENDER === "0") return undefined;

  let workflow = "";
  let totalNodes = 0;
  let cachedNodes = 0;
  const seenNodes = new Set<string>();
  const completedNodes = new Set<string>();
  let lastNodePath: string | undefined;
  let closed = false;

  const write = (line: string): void => {
    process.stderr.write(`${line}\n`);
  };

  const indent = (line: string): string => `  ${line}`;

  const trim = (value: string): string => clip(value, Math.max(40, termWidth() - 4));

  const headerLine = (): string => {
    const left = workflow ? `${bold(operation)} ${dim(workflow)}` : bold(operation);
    return `${accent(sym.active)} ${left}`;
  };

  return {
    render(event) {
      if (closed) return;
      switch (event.type) {
        case "definition.loaded": {
          workflow = stringField(event.workflow) ?? workflow;
          break;
        }
        case "plan.created": {
          workflow = stringField(event.workflow) ?? workflow;
          totalNodes = numberField(event.nodeCount) ?? totalNodes;
          cachedNodes = numberField(event.cachedNodeCount) ?? cachedNodes;
          write(headerLine());
          write(indent(dim(planSummary(totalNodes, cachedNodes))));
          break;
        }
        case "node.cached": {
          const path = stringField(event.nodePath);
          if (!path || completedNodes.has(path)) break;
          completedNodes.add(path);
          seenNodes.add(path);
          write(indent(`${dim(sym.ok)} ${dim(path)}  ${dim("cached")}`));
          break;
        }
        case "node.started": {
          const path = stringField(event.nodePath);
          if (!path || seenNodes.has(path)) break;
          seenNodes.add(path);
          lastNodePath = path;
          write(indent(`${accent(sym.active)} ${bold(path)}`));
          break;
        }
        case "node.completed": {
          const path = stringField(event.nodePath);
          if (!path || completedNodes.has(path)) break;
          completedNodes.add(path);
          if (lastNodePath === path) lastNodePath = undefined;
          const detail = compactId(event.runId);
          const tail = detail ? `  ${dim(detail)}` : "";
          write(indent(`${ok(sym.ok)} ${path}${tail}`));
          break;
        }
        case "vm.created": {
          const vmId = stringField(event.vmId);
          const from = stringField(event.fromSnapshotId);
          const label = from ? `vm ${vmId ?? ""} from ${from}` : `vm ${vmId ?? "ready"}`;
          write(indent(`  ${dim(label)}`));
          break;
        }
        case "command.started": {
          const command = stringField(event.command) ?? stringField(event.commandName);
          if (command) write(indent(`  ${dim(`$ ${trim(command)}`)}`));
          break;
        }
        case "command.output": {
          const data = stringField(event.data);
          if (!data) break;
          for (const line of data.replace(/\r/g, "").split("\n")) {
            if (!line) continue;
            write(indent(`  ${dim(trim(line))}`));
          }
          break;
        }
        case "command.completed": {
          const exitCode = numberField(event.exitCode) ?? 0;
          if (exitCode !== 0) {
            const name = stringField(event.commandName) ?? "command";
            write(indent(`  ${err(`${name} exited ${exitCode}`)}`));
          }
          break;
        }
        case "log.output": {
          const data = stringField(event.data);
          if (!data) break;
          const label = stringField(event.label) ?? stringField(event.stream);
          for (const line of data.replace(/\r/g, "").split("\n")) {
            if (!line) continue;
            const prefix = label ? `${dim(`[${label}]`)} ` : "";
            write(indent(`  ${prefix}${dim(trim(line))}`));
          }
          break;
        }
        case "interaction.awaiting_user": {
          const label = stringField(event.title) ?? stringField(event.label) ?? "user interaction";
          const url = stringField(event.url);
          write(indent(`${accent(sym.arrow)} waiting on ${bold(label)}`));
          if (url) write(indent(`  ${dim(url)}`));
          break;
        }
        case "interaction.completed": {
          const label = stringField(event.title) ?? stringField(event.label) ?? "interaction";
          write(indent(`${ok(sym.ok)} ${dim(`${label} completed`)}`));
          break;
        }
        case "artifact.created": {
          const kind = stringField(event.kind) ?? "artifact";
          const provider = stringField(event.providerId);
          const label = provider ? `${provider}:${kind}` : kind;
          write(indent(`  ${dim(`+ ${label}`)}`));
          break;
        }
        case "workspace.ready": {
          const id = stringField(event.workspaceId) ?? "workspace";
          write(indent(`${ok(sym.ok)} ${bold(id)} ${dim("ready")}`));
          break;
        }
        case "run.completed":
        case "run.failed": {
          // Run terminal events are owned by the CLI's failure renderer so the
          // structured failure block stays in one place.
          break;
        }
      }
    },
    pause() {
      // No-op — output is already append-only.
    },
    resume() {
      // No-op — output is already append-only.
    },
    close() {
      closed = true;
    },
  };
}

function planSummary(total: number, cached: number): string {
  if (total === 0) return "no nodes";
  if (cached === 0) return `${total} ${noun("node", total)}`;
  return `${cached}/${total} cached`;
}

function noun(singular: string, count: number): string {
  return count === 1 ? singular : `${singular}s`;
}

function compactId(value: unknown): string {
  return typeof value === "string" && value.length > 0 ? value.slice(0, 8) : "";
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

