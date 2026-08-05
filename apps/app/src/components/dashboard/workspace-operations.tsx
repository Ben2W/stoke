"use client";

import type { ManagedProject, ManagedRun, ManagedWorkspace } from "@usestoke/managed";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleDashed, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { executeProjectRequest } from "../../lib/api-client.ts";
import { queryKeys } from "../../lib/queries.ts";
import { OperationInputDialog } from "./operation-input-dialog.tsx";
import { operationHasInput, type OperationInput } from "./operation-input.ts";
import { useRunObserver } from "./use-run-observer.ts";
import { WorkspaceOperationRunDialog } from "./workspace-operation-run-dialog.tsx";

const DASHBOARD_CAPABILITIES = new Set(["browser.open", "ssh"]);

export function WorkspaceOperations({ project, workspace }: {
  project: ManagedProject;
  workspace: ManagedWorkspace;
}) {
  const queryClient = useQueryClient();
  const [activeRunId, setActiveRunId] = useState<string>();
  const [selectedOperation, setSelectedOperation] = useState<ManagedWorkspace["operations"][number]>();
  const [executingOperation, setExecutingOperation] = useState<ManagedWorkspace["operations"][number]>();
  const [capabilityReady, setCapabilityReady] = useState(false);
  const previewWindow = useRef<Window | null>(null);
  const terminalWindow = useRef<Window | null>(null);
  const handledEvents = useRef(new Set<number>());
  const observed = useRunObserver(activeRunId);
  const execute = useMutation({
    mutationFn: (input: { workspaceOperation: string; opensBrowser: boolean; operationInput: OperationInput }) => executeProjectRequest(project.id, {
      operation: "run",
      workflow: workspace.workflow,
      workspace: workspace.name,
      workspaceOperation: input.workspaceOperation,
      input: input.operationInput,
    }),
    onSuccess: (response) => {
      queryClient.setQueryData<ManagedRun[]>(queryKeys.runs, (runs = []) => [
        response.run,
        ...runs.filter((run) => run.id !== response.run.id),
      ]);
      setActiveRunId(response.run.id);
      setSelectedOperation(undefined);
    },
    onError: (_error, input) => {
      if (input.opensBrowser) {
        previewWindow.current?.close();
        previewWindow.current = null;
      }
      terminalWindow.current?.close();
      terminalWindow.current = null;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.runs });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectWorkspaces(project.id) });
    },
  });

  useEffect(() => {
    for (const event of observed.eventsResult.data ?? []) {
      if (handledEvents.current.has(event.id) || event.data.type !== "host.capability.request") continue;
      handledEvents.current.add(event.id);
      if (event.data.capability === "browser.open") {
        const url = browserUrl(event.data.params);
        if (!url) continue;
        setCapabilityReady(true);
        const target = previewWindow.current;
        previewWindow.current = null;
        void waitForNavigationFeedback().then(() => {
          if (target && !target.closed) target.location.replace(url);
          else window.open(url, "_blank", "noopener,noreferrer");
        });
      }
      if (event.data.capability === "ssh") {
        const request = sandboxTerminalRequest(event.data.params, workspace.name);
        if (!request) continue;
        const url = terminalUrl(project.id, request);
        setCapabilityReady(true);
        const target = terminalWindow.current;
        terminalWindow.current = null;
        void waitForNavigationFeedback().then(() => {
          if (target && !target.closed) target.location.replace(url);
          else window.open(url, "_blank");
        });
      }
    }
  }, [observed.eventsResult.data, project.id, workspace.name]);

  useEffect(() => {
    if (!observed.run || observed.run.status === "running") return;
    void queryClient.invalidateQueries({ queryKey: queryKeys.projectWorkspaces(project.id) });
    if (observed.run.status === "failed" || observed.run.status === "orphaned") {
      previewWindow.current?.close();
      previewWindow.current = null;
      terminalWindow.current?.close();
      terminalWindow.current = null;
    }
  }, [observed.run, project.id, queryClient]);

  const runOperation = (operation: ManagedWorkspace["operations"][number], operationInput: OperationInput = {}) => {
    const opensBrowser = operation.requiredCapabilities.some((capability) => capability.id === "browser.open");
    const opensTerminal = operation.requiredCapabilities.some((capability) => capability.id === "ssh");
    execute.reset();
    setSelectedOperation(undefined);
    setExecutingOperation(operation);
    setActiveRunId(undefined);
    setCapabilityReady(false);
    if (opensBrowser) {
      previewWindow.current = window.open("", "_blank");
      renderPreviewPlaceholder(previewWindow.current);
    }
    if (opensTerminal) {
      terminalWindow.current = window.open(terminalLoadingUrl(workspace.name), "_blank");
    }
    execute.mutate({ workspaceOperation: operation.id, opensBrowser, operationInput });
  };

  const operationIsRunning = execute.isPending || observed.run?.status === "running";

  return (
    <section className="mt-8" aria-labelledby="operations-heading">
      <h2 className="text-sm font-medium" id="operations-heading">Operations</h2>
      <p className="mt-1 text-xs text-zinc-500">Actions exposed by this workspace’s Stoke workflow.</p>
      <div className="mt-3 overflow-hidden rounded-lg border border-zinc-200 bg-white">
        {workspace.operations.length ? workspace.operations.map((operation, index) => {
          const unavailable = operation.requiredCapabilities.filter((capability) => !DASHBOARD_CAPABILITIES.has(capability.id));
          const hasInput = operationHasInput(operation.inputSchema);
          const isActive = executingOperation?.id === operation.id && operationIsRunning;
          const waitsForCapability = operation.requiredCapabilities.some((capability) => capability.id === "ssh" || capability.id === "browser.open");
          const isStarting = isActive && (!waitsForCapability || !capabilityReady);
          return (
            <div className={`flex items-center justify-between gap-4 p-4 ${index ? "border-t border-zinc-100" : ""}`} key={operation.id}>
              <div>
                <p className="text-sm font-medium">{operation.title ?? operation.id}</p>
                <p className="mt-1 text-xs text-zinc-500">
                  {operation.description ?? operation.id}
                  {unavailable.length ? ` · Dashboard doesn’t support ${unavailable.map((item) => item.id).join(", ")}.` : hasInput ? " · Configurable input" : ""}
                </p>
              </div>
              <button className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-zinc-200 px-3 text-[11px] font-medium hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40" disabled={operationIsRunning || unavailable.length > 0} onClick={() => hasInput ? setSelectedOperation(operation) : runOperation(operation)} type="button">
                {isStarting ? <CircleDashed className="animate-spin" size={12} /> : <Play size={12} />}{isStarting ? "Loading…" : isActive ? "Running…" : "Run"}
              </button>
            </div>
          );
        }) : <p className="p-5 text-xs text-zinc-500">This workflow does not expose additional workspace operations.</p>}
      </div>
      {execute.isError ? <p className="mt-3 text-xs text-red-600">{execute.error.message}</p> : null}
      {selectedOperation ? <OperationInputDialog error={execute.isError ? execute.error.message : undefined} onClose={() => setSelectedOperation(undefined)} onSubmit={(input) => runOperation(selectedOperation, input)} operation={selectedOperation} pending={execute.isPending} /> : null}
      {executingOperation ? (
        <WorkspaceOperationRunDialog
          error={execute.isError ? execute.error.message : undefined}
          events={observed.eventsResult.data ?? []}
          onClose={() => setExecutingOperation(undefined)}
          operation={executingOperation}
          pending={execute.isPending}
          run={observed.run}
        />
      ) : null}
    </section>
  );
}

function browserUrl(params: unknown): string | undefined {
  if (!isRecord(params) || typeof params.url !== "string") return undefined;
  try {
    const url = new URL(params.url);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function sandboxTerminalRequest(params: unknown, fallbackTitle: string): { sandbox: string; title: string; cwd: string } | undefined {
  if (!isRecord(params) || params.provider !== "vercel-sandbox" || typeof params.sandbox !== "string") return undefined;
  return {
    sandbox: params.sandbox,
    title: typeof params.title === "string" && params.title.trim() ? params.title : fallbackTitle,
    cwd: typeof params.cwd === "string" && params.cwd.trim() ? params.cwd : "/vercel/sandbox",
  };
}

function terminalLoadingUrl(title: string): string {
  const url = new URL("/terminal", window.location.origin);
  url.searchParams.set("title", `SSH ${title}`);
  return url.toString();
}

function terminalUrl(projectId: string, input: { sandbox: string; title: string; cwd: string }): string {
  const url = new URL("/terminal", window.location.origin);
  url.searchParams.set("project", projectId);
  url.searchParams.set("sandbox", input.sandbox);
  url.searchParams.set("title", input.title);
  url.searchParams.set("cwd", input.cwd);
  return url.toString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function renderPreviewPlaceholder(target: Window | null): void {
  if (!target) return;
  target.document.title = "Opening preview…";
  target.document.body.style.cssText = "margin:0;background:#fafafa;color:#18181b;font:14px ui-sans-serif,system-ui,sans-serif;display:grid;min-height:100vh;place-items:center";
  const status = target.document.createElement("p");
  status.textContent = "Opening preview…";
  target.document.body.replaceChildren(status);
}

function waitForNavigationFeedback(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 500));
}
