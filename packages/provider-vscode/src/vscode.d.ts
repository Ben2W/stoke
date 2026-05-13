declare module "vscode" {
  export type Event<T> = (listener: (event: T) => unknown) => Disposable;

  export interface Disposable {
    dispose(): unknown;
  }

  export class EventEmitter<T> implements Disposable {
    readonly event: Event<T>;
    fire(data: T): void;
    dispose(): void;
  }

  export class Uri {
    readonly fsPath: string;
    static file(path: string): Uri;
    static parse(value: string): Uri;
    toString(): string;
  }

  export class ThemeIcon {
    constructor(id: string);
  }

  export enum TreeItemCollapsibleState {
    None = 0,
    Collapsed = 1,
    Expanded = 2
  }

  export class TreeItem {
    label?: string;
    description?: string;
    tooltip?: string;
    iconPath?: ThemeIcon;
    contextValue?: string;
    command?: Command;
    constructor(label: string, collapsibleState?: TreeItemCollapsibleState);
  }

  export interface Command {
    command: string;
    title: string;
    arguments?: unknown[];
  }

  export interface TreeDataProvider<T> {
    readonly onDidChangeTreeData?: Event<T | undefined | null | void>;
    getTreeItem(element: T): TreeItem | Thenable<TreeItem>;
    getChildren(element?: T): ProviderResult<T[]>;
  }

  export type ProviderResult<T> = T | undefined | null | Thenable<T | undefined | null>;

  export interface WorkspaceFolder {
    readonly uri: Uri;
    readonly name: string;
  }

  export interface WorkspaceConfiguration {
    get<T>(key: string, defaultValue: T): T;
  }

  export interface ExtensionContext {
    readonly subscriptions: Disposable[];
  }

  export enum ProgressLocation {
    Notification = 15,
    Window = 10
  }

  export interface ProgressOptions {
    location: ProgressLocation;
    title?: string;
  }

  export interface QuickPickItem {
    label: string;
    description?: string;
    detail?: string;
  }

  export interface InputBoxOptions {
    title?: string;
    prompt?: string;
    value?: string;
    ignoreFocusOut?: boolean;
  }

  export interface Terminal {
    sendText(text: string): void;
    show(preserveFocus?: boolean): void;
  }

  export const window: {
    showInformationMessage(message: string, ...items: string[]): Thenable<string | undefined>;
    showWarningMessage(message: string, ...items: string[]): Thenable<string | undefined>;
    showErrorMessage(message: string, ...items: string[]): Thenable<string | undefined>;
    showInputBox(options?: InputBoxOptions): Thenable<string | undefined>;
    showQuickPick<T extends QuickPickItem>(items: readonly T[], options?: { title?: string; placeHolder?: string; ignoreFocusOut?: boolean }): Thenable<T | undefined>;
    registerTreeDataProvider<T>(viewId: string, provider: TreeDataProvider<T>): Disposable;
    withProgress<R>(options: ProgressOptions, task: () => Thenable<R>): Thenable<R>;
    createOutputChannel(name: string): OutputChannel;
    createTerminal(options: { name: string; cwd?: string; env?: Record<string, string | undefined> }): Terminal;
  };

  export interface OutputChannel extends Disposable {
    appendLine(value: string): void;
    show(preserveFocus?: boolean): void;
  }

  export const workspace: {
    readonly workspaceFolders?: readonly WorkspaceFolder[];
    getConfiguration(section?: string): WorkspaceConfiguration;
  };

  export const commands: {
    registerCommand(command: string, callback: (...args: any[]) => unknown): Disposable;
    executeCommand<T = unknown>(command: string, ...args: unknown[]): Thenable<T>;
  };

  export const env: {
    openExternal(target: Uri): Thenable<boolean>;
  };
}
