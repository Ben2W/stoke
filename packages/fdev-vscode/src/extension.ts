import * as vscode from "vscode";
import {
  getOrStartRuntime,
  type RuntimeClient,
  type RuntimeControlOperation,
  type RuntimeControlWorkspace,
} from "@freestyle-sh/fdev-runtime-client";
import { collectOperationInput } from "./input.ts";
import { resolveFdevProject, type FdevProject } from "./project.ts";
import { FDEV_VSCODE_VERSION } from "./version.ts";

const VSCODE_HOST_METHODS: Array<{ id: string; modes?: string[] }> = [
  { id: "message.show" },
  { id: "prompt.text" },
  { id: "prompt.confirm" },
  { id: "prompt.select" },
  { id: "open.external" },
];

type HostRequestMessage = Record<string, unknown> & {
  type: "host.request";
  id: string;
  method: string;
  params?: unknown;
};

type HostCapabilityRequestMessage = Record<string, unknown> & {
  type: "host.capability.request";
  id: string;
  capability: string;
  params?: unknown;
};

export function activate(context: vscode.ExtensionContext): void {
  const host = new FdevVsCodeHost();
  const operations = new OperationsProvider(host);
  const workspaces = new WorkspacesProvider(host);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("fdevOperations", operations),
    vscode.window.registerTreeDataProvider("fdevWorkspaces", workspaces),
    vscode.commands.registerCommand("fdev.refresh", async () => {
      host.clearCache();
      operations.refresh();
      workspaces.refresh();
    }),
    vscode.commands.registerCommand("fdev.runOperation", async (operation?: RuntimeControlOperation) => {
      await host.runOperation(operation);
      operations.refresh();
      workspaces.refresh();
    }),
    vscode.commands.registerCommand("fdev.openWorkspace", async (workspace?: RuntimeControlWorkspace) => {
      await host.runWorkspaceAction(workspace);
      workspaces.refresh();
    }),
  );
}

export function deactivate(): void {}

class FdevVsCodeHost {
  private output = vscode.window.createOutputChannel("fdev");
  private runtimePromise: Promise<RuntimeClient> | undefined;

  clearCache(): void {
    this.runtimePromise = undefined;
  }

  async listOperations(): Promise<RuntimeControlOperation[]> {
    const runtime = await this.runtime();
    return [...(await runtime.control.operations()).operations];
  }

  async listWorkspaces(): Promise<RuntimeControlWorkspace[]> {
    const runtime = await this.runtime();
    return [...(await runtime.control.workspaces()).workspaces];
  }

  async runOperation(operation?: RuntimeControlOperation, presetWorkspace?: RuntimeControlWorkspace): Promise<void> {
    const runtime = await this.runtime();
    const operations = await this.listOperations();
    const selected = operation ?? await pickOperation(operations);
    if (!selected) return;

    const unsupported = unsupportedRequirements(selected);
    if (unsupported) {
      await vscode.window.showErrorMessage(unsupported);
      return;
    }

    const workspaces = await this.listWorkspaces();
    const input = await collectOperationInput(selected, workspaces, operationPrompt(presetWorkspace));
    if (!input) return;

    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: `fdev ${selected.title}`,
    }, async () => {
      const started = await runtime.control.startRun({ operation: selected.id, input });
      await runtime.runSession(started.runId, {
        hello: {
          type: "hello",
          transportVersion: 1,
          host: {
            name: "fdev-vscode",
            version: FDEV_VSCODE_VERSION,
          },
          hostMethods: [...VSCODE_HOST_METHODS],
          hostCapabilities: [],
        },
        onMessage: async (message, session) => {
          if (isHostRequestMessage(message)) {
            await answerHostRequest(message, session);
            return;
          }
          if (isHostCapabilityRequestMessage(message)) {
            session.send({
              type: "response",
              id: message.id,
              error: {
                code: "UNSUPPORTED_CAPABILITY",
                message: `VS Code host does not support host capability ${message.capability}`,
              },
            });
            return;
          }
          this.logRunMessage(message);
        },
      });

      const completed = await runtime.control.run(started.runId);
      if (completed.status === "failed") {
        throw new Error(completed.error?.message ?? `fdev operation ${selected.id} failed`);
      }
    });
  }

  async runWorkspaceAction(workspace?: RuntimeControlWorkspace): Promise<void> {
    const operations = await this.listOperations();
    const workspaces = await this.listWorkspaces();
    const selectedWorkspace = workspace ?? await pickWorkspace("Workspace", workspaces);
    if (!selectedWorkspace) return;

    const workspaceActions = operations.filter((operation) => operation.kind === "workspace-action");
    const selectedOperation = await pickOperation(workspaceActions, `Run action for ${selectedWorkspace.name}`);
    if (!selectedOperation) return;

    await this.runOperation(selectedOperation, selectedWorkspace);
  }

  private runtime(): Promise<RuntimeClient> {
    this.runtimePromise ??= this.resolveRuntime();
    return this.runtimePromise;
  }

  private async resolveRuntime(): Promise<RuntimeClient> {
    const project = resolveWorkspaceProject();
    const config = vscode.workspace.getConfiguration("fdev");
    const statePath = config.get<string | undefined>("statePath", undefined);
    return await getOrStartRuntime({
      projectDir: project.projectDir,
      configPath: project.configPath,
      ...(statePath ? { statePath } : {}),
    });
  }

  private logRunMessage(message: unknown): void {
    if (!isRecord(message)) return;
    if (message.type === "hello.ack" || message.type === "heartbeat.ack") return;
    this.output.appendLine(JSON.stringify(message));
  }
}

class OperationsProvider implements vscode.TreeDataProvider<RuntimeControlOperation> {
  private readonly changed = new vscode.EventEmitter<RuntimeControlOperation | undefined>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(private readonly host: FdevVsCodeHost) {}

  refresh(): void {
    this.changed.fire(undefined);
  }

  getTreeItem(operation: RuntimeControlOperation): vscode.TreeItem {
    const item = new vscode.TreeItem(operation.title || operation.id, vscode.TreeItemCollapsibleState.None);
    item.description = operation.id;
    item.tooltip = operation.description || operation.id;
    item.iconPath = new vscode.ThemeIcon(operation.kind === "workspace-action" ? "tools" : "play");
    item.contextValue = "fdevOperation";
    item.command = {
      command: "fdev.runOperation",
      title: "Run Operation",
      arguments: [operation],
    };
    return item;
  }

  async getChildren(): Promise<RuntimeControlOperation[]> {
    return await this.host.listOperations();
  }
}

class WorkspacesProvider implements vscode.TreeDataProvider<RuntimeControlWorkspace> {
  private readonly changed = new vscode.EventEmitter<RuntimeControlWorkspace | undefined>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(private readonly host: FdevVsCodeHost) {}

  refresh(): void {
    this.changed.fire(undefined);
  }

  getTreeItem(workspace: RuntimeControlWorkspace): vscode.TreeItem {
    const item = new vscode.TreeItem(workspace.name, vscode.TreeItemCollapsibleState.None);
    item.description = workspace.workflow;
    item.tooltip = workspace.resourceId || workspace.name;
    item.iconPath = new vscode.ThemeIcon("server");
    item.contextValue = "fdevWorkspace";
    item.command = {
      command: "fdev.openWorkspace",
      title: "Run Workspace Action",
      arguments: [workspace],
    };
    return item;
  }

  async getChildren(): Promise<RuntimeControlWorkspace[]> {
    return await this.host.listWorkspaces();
  }
}

const vscodePrompt = {
  async inputText(input: { name: string; description?: string; defaultValue?: string }) {
    return await vscode.window.showInputBox({
      title: input.name,
      prompt: input.description,
      value: input.defaultValue,
      ignoreFocusOut: true,
    });
  },
  async confirm(input: { name: string; description?: string; defaultValue?: boolean }) {
    const answer = await vscode.window.showQuickPick([
      { label: "Yes" },
      { label: "No" },
    ], {
      title: input.name,
      placeHolder: input.description,
      ignoreFocusOut: true,
    });
    if (!answer) return undefined;
    return answer.label === "Yes";
  },
  async pickWorkspace(input: { name: string; description?: string; workspaces: RuntimeControlWorkspace[] }) {
    return await pickWorkspace(input.description ?? input.name, input.workspaces);
  },
};

function operationPrompt(presetWorkspace: RuntimeControlWorkspace | undefined) {
  if (!presetWorkspace) return vscodePrompt;
  return {
    ...vscodePrompt,
    async pickWorkspace() {
      return presetWorkspace;
    },
  };
}

async function pickOperation(
  operations: RuntimeControlOperation[],
  title = "fdev operation",
): Promise<RuntimeControlOperation | undefined> {
  const items = operations.map((operation) => ({
    label: operation.title || operation.id,
    description: operation.id,
    detail: operation.description,
    operation,
  }));
  const picked = await vscode.window.showQuickPick(items, { title, ignoreFocusOut: true });
  return picked?.operation;
}

async function pickWorkspace(
  title: string,
  workspaces: RuntimeControlWorkspace[],
): Promise<RuntimeControlWorkspace | undefined> {
  const items = workspaces.map((workspace) => ({
    label: workspace.name,
    description: workspace.workflow,
    detail: workspace.resourceId,
    workspace,
  }));
  const picked = await vscode.window.showQuickPick(items, { title, ignoreFocusOut: true });
  return picked?.workspace;
}

function resolveWorkspaceProject(): FdevProject {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) throw new Error("Open a workspace folder before using fdev.");
  return resolveFdevProject(folder.uri.fsPath);
}

async function answerHostRequest(
  message: HostRequestMessage,
  session: { send(message: unknown): void },
): Promise<void> {
  try {
    session.send({
      type: "response",
      id: message.id,
      result: await handleHostRequest(message.method, message.params),
    });
  } catch (error) {
    session.send({
      type: "response",
      id: message.id,
      error: {
        code: "HOST_REQUEST_FAILED",
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

async function handleHostRequest(method: string, params: unknown): Promise<unknown> {
  switch (method) {
    case "message.show":
      await showMessage(params);
      return null;
    case "prompt.text":
      return await vscodePrompt.inputText({
        name: stringField(params, "message") ?? "Input",
        defaultValue: stringField(params, "defaultValue"),
      });
    case "prompt.confirm":
      return await vscodePrompt.confirm({
        name: stringField(params, "message") ?? "Confirm",
        defaultValue: booleanField(params, "defaultValue"),
      });
    case "prompt.select":
      return await promptSelect(params);
    case "open.external":
      return await openExternal(params);
    case "host.command.run":
      throw new Error("VS Code host does not support host.command.run");
    default:
      throw new Error(`Unsupported host method ${method}`);
  }
}

async function showMessage(params: unknown): Promise<void> {
  const message = stringField(params, "message") ?? "";
  const level = stringField(params, "level") ?? "info";
  if (level === "error") await vscode.window.showErrorMessage(message);
  else if (level === "warning" || level === "warn") await vscode.window.showWarningMessage(message);
  else await vscode.window.showInformationMessage(message);
}

async function promptSelect(params: unknown): Promise<string | undefined> {
  const options = isRecord(params) && Array.isArray(params.options)
    ? params.options.filter(isRecord).flatMap((item) => {
      const value = typeof item.value === "string" ? item.value : undefined;
      if (!value) return [];
      return [{
        label: typeof item.label === "string" ? item.label : value,
        description: typeof item.description === "string" ? item.description : undefined,
        value,
      }];
    })
    : [];
  const picked = await vscode.window.showQuickPick(options, {
    title: stringField(params, "message") ?? "Choose",
    ignoreFocusOut: true,
  });
  return picked?.value;
}

async function openExternal(params: unknown): Promise<null> {
  const target = stringField(params, "target");
  if (!target) throw new Error("open.external requires target");
  await vscode.env.openExternal(vscode.Uri.parse(target));
  return null;
}

function unsupportedRequirements(operation: RuntimeControlOperation): string | undefined {
  const unsupportedCapability = operation.requiredHostCapabilities?.[0];
  if (unsupportedCapability) {
    return `Operation "${operation.id}" requires host capability "${unsupportedCapability.id}". VS Code does not support that capability.`;
  }
  const unsupportedMethod = operation.requiredHostMethods?.find((method) =>
    !VSCODE_HOST_METHODS.some((supported) =>
      supported.id === method.id && (!method.modes?.length || method.modes.every((mode) => supported.modes?.includes(mode)))
    )
  );
  if (unsupportedMethod) {
    return `Operation "${operation.id}" requires host method "${unsupportedMethod.id}".`;
  }
  return undefined;
}

function isHostRequestMessage(value: unknown): value is HostRequestMessage {
  return isRecord(value) &&
    value.type === "host.request" &&
    typeof value.id === "string" &&
    typeof value.method === "string";
}

function isHostCapabilityRequestMessage(value: unknown): value is HostCapabilityRequestMessage {
  return isRecord(value) &&
    value.type === "host.capability.request" &&
    typeof value.id === "string" &&
    typeof value.capability === "string";
}

function stringField(value: unknown, key: string): string | undefined {
  return isRecord(value) && typeof value[key] === "string" ? value[key] : undefined;
}

function booleanField(value: unknown, key: string): boolean | undefined {
  return isRecord(value) && typeof value[key] === "boolean" ? value[key] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
