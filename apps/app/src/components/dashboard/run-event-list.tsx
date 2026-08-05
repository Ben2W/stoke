import type { ManagedRun, ManagedRunEvent } from "@stoke/managed";
import { Check, Circle, CircleDashed, Cloud, Terminal, X } from "lucide-react";
import { useEffect, useRef } from "react";

export function RunEventList({ events, run }: { events: ManagedRunEvent[]; run: ManagedRun }) {
  const timelineRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (run.status === "running") timelineRef.current?.scrollTo({ top: timelineRef.current.scrollHeight, behavior: "smooth" });
  }, [events.length, run.status]);

  const completeNodes = events.filter((event) => event.type === "node.completed" || event.type === "node.cached").length;
  const nodeCount = run.nodeCount ?? Math.max(completeNodes, 1);
  const progress = run.status === "completed" ? 100 : Math.min(100, Math.round((completeNodes / nodeCount) * 100));
  return (
    <div className="flex min-h-72 flex-col">
      <div className="border-b border-zinc-100 px-5 py-3">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <p className="truncate text-xs font-medium capitalize text-zinc-900">{run.operation} · {run.workflow}</p>
            <p className="mt-0.5 truncate text-[11px] text-zinc-500">{run.deviceName} · {run.id.slice(0, 8)}</p>
          </div>
          <StatusBadge status={run.status} />
        </div>
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-zinc-100"><div className="h-full rounded-full bg-emerald-500 transition-[width] duration-500" style={{ width: `${progress}%` }} /></div>
      </div>

      {events.length ? (
        <ol className="max-h-[28rem] flex-1 overflow-y-auto px-5 py-4" ref={timelineRef}>
          {events.map((event) => <RunEvent event={event} key={event.id} />)}
        </ol>
      ) : (
        <div className="grid flex-1 place-items-center px-6 py-14 text-center">
          <div>
            <CircleDashed className={`mx-auto text-zinc-300 ${run.status === "running" ? "animate-spin" : ""}`} size={22} />
            <p className="mt-3 text-xs text-zinc-500">{run.status === "running" ? "Waiting for the first event…" : "No event details were recorded."}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function RunEvent({ event }: { event: ManagedRunEvent }) {
  const commandOutput = (event.type === "command.output" || event.type === "log.output") && typeof event.data.data === "string"
    ? event.data.data.trimEnd()
    : undefined;

  return (
    <li className="relative flex gap-3 pb-3 last:pb-0">
      <span className="absolute bottom-0 left-[5px] top-3 w-px bg-zinc-100 last:hidden" />
      <EventIcon event={event} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="truncate text-xs text-zinc-700">{eventLabel(event)}</p>
          <time className="shrink-0 text-[10px] tabular-nums text-zinc-400">{formatEventTime(event.createdAt)}</time>
        </div>
        {commandOutput ? <pre className="mt-1.5 overflow-x-auto rounded bg-zinc-950 px-3 py-2 text-[10px] leading-4 text-zinc-300">{commandOutput}</pre> : null}
      </div>
    </li>
  );
}

function EventIcon({ event }: { event: ManagedRunEvent }) {
  if (event.type === "run.failed") return <X className="relative z-10 mt-0.5 shrink-0 rounded-full bg-white text-red-600" size={12} />;
  if (event.type === "node.completed" || event.type === "node.cached" || event.type === "run.completed") {
    return <Check className="relative z-10 mt-0.5 shrink-0 rounded-full bg-white text-emerald-600" size={12} />;
  }
  if (event.type === "node.started") return <CircleDashed className="relative z-10 mt-0.5 shrink-0 animate-spin rounded-full bg-white text-blue-600" size={12} />;
  if (event.type.startsWith("remote.")) return <Cloud className="relative z-10 mt-0.5 shrink-0 bg-white text-violet-500" size={12} />;
  if (event.type.startsWith("command.")) return <Terminal className="relative z-10 mt-0.5 shrink-0 bg-white text-zinc-400" size={12} />;
  return <Circle className="relative z-10 mt-1 shrink-0 fill-white text-zinc-300" size={11} />;
}

function StatusBadge({ status }: { status: ManagedRun["status"] }) {
  const styles = status === "running"
    ? "bg-blue-50 text-blue-700"
    : status === "completed"
      ? "bg-emerald-50 text-emerald-700"
      : "bg-red-50 text-red-700";
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-medium capitalize ${styles}`}>
      {status === "running" ? <span className="size-1.5 animate-pulse rounded-full bg-blue-500" /> : null}
      {status}
    </span>
  );
}

function eventLabel(event: ManagedRunEvent): string {
  const node = typeof event.data.nodePath === "string" ? event.data.nodePath : undefined;
  const command = typeof event.data.commandName === "string" ? event.data.commandName : undefined;
  const remoteCommand = typeof event.data.command === "string" ? event.data.command : undefined;
  switch (event.type) {
    case "workflow.apply.started": return `Applying ${String(event.data.workflow ?? "workflow")}`;
    case "workflow.apply.completed": return `Applied ${String(event.data.workflow ?? "workflow")}`;
    case "plan.created": return `Planned ${String(event.data.nodeCount ?? 0)} nodes`;
    case "node.started": return `Started ${node ?? "node"}`;
    case "node.completed": return `Completed ${node ?? "node"}`;
    case "node.cached": return `Restored ${node ?? "node"} from cache`;
    case "command.started": return `Running ${command ?? "command"}`;
    case "command.output": return command ?? "Command output";
    case "log.output": return `${node ?? "Workflow"} · ${String(event.data.stream ?? "log")}`;
    case "command.completed": return `${command ?? "Command"} exited ${String(event.data.exitCode ?? 0)}`;
    case "artifact.created": return `Created ${String(event.data.kind ?? "artifact")}`;
    case "remote.sandbox.created": return `Vercel Sandbox ${String(event.data.sandboxName ?? "created")}`;
    case "remote.command.started": return `Starting ${formatRemoteCommand(remoteCommand)}`;
    case "remote.command.completed": return `${formatRemoteCommand(remoteCommand)} completed`;
    case "run.completed": return "Apply completed";
    case "run.failed": return typeof event.data.error === "object" ? "Apply failed" : "Apply failed";
    default: return event.type.replaceAll(".", " ");
  }
}

function formatRemoteCommand(command: string | undefined): string {
  if (!command) return "remote command";
  return command.replaceAll("-", " ");
}

function formatEventTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(new Date(value));
}
