import { defineDevMachine, defineStep, env } from "@freestyle-sh/fdev-sdk";
import { defineFreestyleProvider } from "@freestyle-sh/fdev-provider-freestyle";

const repo = "freestyle-sh/freestyle-website-next";
const repoUrl = `https://github.com/${repo}.git`;
const repoPath = "/workspace/freestyle-website-next";
const devPort = 4321;
const devCommand = `bun dev --host 0.0.0.0 --port ${devPort}`;
const vscodeServerCommit = process.env.FDEV_PREINSTALL_VSCODE_SERVER === "1"
  ? localVsCodeCommit() ?? null
  : null;

const installToolchain = defineStep<
  { vscodeServerCommit: string | null },
  { vscodeServerCommit: string | null }
>("website:install-toolchain", async ({ input, vm }) => {
  await vm.exec(
    [
      "set -e",
      "export DEBIAN_FRONTEND=noninteractive",
      "apt-get update -qq",
      [
        "apt-get install -y -qq",
        "build-essential",
        "ca-certificates",
        "curl",
        "git",
        "gnupg",
        "pkg-config",
        "python3",
        "unzip",
        "xz-utils",
      ].join(" "),
    ].join("\n"),
    {
      name: "install system packages",
      timeoutMs: 10 * 60 * 1000,
    },
  );

  await vm.exec(
    [
      "set -e",
      "export DEBIAN_FRONTEND=noninteractive",
      "if ! command -v gh >/dev/null 2>&1; then",
      "  if ! apt-get install -y -qq gh; then",
      "    mkdir -p /etc/apt/keyrings",
      "    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli-archive-keyring.gpg",
      "    chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg",
      "    printf 'deb [arch=%s signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main\\n' \"$(dpkg --print-architecture)\" > /etc/apt/sources.list.d/github-cli.list",
      "    apt-get update -qq",
      "    apt-get install -y -qq gh",
      "  fi",
      "fi",
      "gh --version",
    ].join("\n"),
    {
      name: "install github cli",
      timeoutMs: 5 * 60 * 1000,
    },
  );

  await vm.exec(
    [
      "set -e",
      "export HOME=\"${HOME:-/root}\"",
      "mkdir -p \"$HOME\"",
      "if [ ! -x /opt/bun/bin/bun ]; then curl -fsSL https://bun.sh/install | HOME=\"$HOME\" BUN_INSTALL=/opt/bun bash; fi",
      "ln -sf /opt/bun/bin/bun /usr/local/bin/bun",
      "git config --global init.defaultBranch main",
      "bun --version",
    ].join("\n"),
    {
      name: "install bun",
      timeoutMs: 5 * 60 * 1000,
    },
  );

  if (input.vscodeServerCommit) {
    try {
      await vm.exec(installVsCodeServerCommand(input.vscodeServerCommit), {
        name: "preinstall vscode server",
        timeoutMs: 10 * 60 * 1000,
      });
    } catch (error) {
      console.warn(
        `Skipping VS Code server preinstall after failure: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return {
    vscodeServerCommit: input.vscodeServerCommit,
  };
});
const installToolchainStep = installToolchain({ vscodeServerCommit });

const githubAuthStep = defineStep(
  "website:github-auth",
  { dependsOn: [installToolchainStep] },
  async ({ interact, vm }) => {
    const authenticated = await vm.probe("gh auth status -h github.com >/dev/null 2>&1", {
      name: "check github auth",
    });
    if (authenticated.ok) return;

    await interact.terminal("Log in to GitHub", {
      command: "gh auth login --hostname github.com --git-protocol https --web",
      instructions:
        "Complete the GitHub device/browser login in this terminal. Click Finished after gh reports that authentication succeeded.",
    });

    const verified = await vm.probe("gh auth status -h github.com >/dev/null 2>&1", {
      name: "verify github auth",
    });
    if (!verified.ok) {
      const status = await vm.probe("gh auth status -h github.com 2>&1", {
        name: "explain github auth",
      });
      throw new Error(`GitHub CLI is not authenticated:\n${status.stdout || status.stderr}`.trim());
    }
  },
);

const cloneRepoStep = defineStep(
  "website:clone-repo",
  { dependsOn: [githubAuthStep] },
  async ({ vm }) => {
    const cloned = await vm.probe(`test -d ${shellQuote(repoPath + "/.git")}`, {
      name: "check website checkout",
    });

    if (!cloned.ok) {
      await vm.exec(
        [
          "set -e",
          `mkdir -p ${shellQuote(dirname(repoPath))}`,
          `gh repo clone ${shellQuote(repo)} ${shellQuote(repoPath)}`,
        ].join("\n"),
        {
          name: "clone website repo",
          timeoutMs: 5 * 60 * 1000,
        },
      );
    }

    await vm.exec(
      [
        "set -e",
        `cd ${shellQuote(repoPath)}`,
        `git remote set-url origin ${shellQuote(repoUrl)}`,
        "git fetch --prune origin",
        "git config --global --add safe.directory " + shellQuote(repoPath),
      ].join("\n"),
      {
        name: "refresh website repo",
        timeoutMs: 5 * 60 * 1000,
      },
    );

    return {
      repoPath,
      repo,
    };
  },
);

const installDependenciesStep = defineStep(
  "website:install-dependencies",
  { dependsOn: [cloneRepoStep] },
  async ({ ctx, vm }) => {
    await vm.exec(`cd ${shellQuote(ctx.steps.repoPath)} && bun install`, {
      name: "install website dependencies",
      timeoutMs: 10 * 60 * 1000,
    });

    await vm.writeFile(
      `${ctx.steps.repoPath}/.vscode/tasks.json`,
      JSON.stringify(
        {
          version: "2.0.0",
          tasks: [
            {
              label: "dev server",
              type: "shell",
              command: devCommand,
              options: { cwd: ctx.steps.repoPath },
              isBackground: true,
              problemMatcher: [],
              presentation: {
                reveal: "always",
                panel: "dedicated",
              },
              runOptions: {
                runOn: "folderOpen",
              },
            },
          ],
        },
        null,
        2,
      ) + "\n",
    );

    return {
      devCommand,
      devPort,
    };
  },
);

export default defineDevMachine({
  name: "freestyle-website-next",
  provider: defineFreestyleProvider({
    apiKey: env("FREESTYLE_API_KEY"),
    image: "ubuntu-24.04",
  }),
  steps: [
    installToolchainStep,
    githubAuthStep,
    cloneRepoStep,
    installDependenciesStep,
  ],
  workspace: {
    cwd: repoPath,
    ports: [devPort],
    onCreated: async ({ ctx, local, vm, workspace }) => {
      const branch = `fdev/${workspace.name.replaceAll(/[^A-Za-z0-9._/-]/g, "-")}`;
      await vm.exec(
        [
          "set -e",
          `cd ${shellQuote(ctx.steps.repoPath)}`,
          `git switch -C ${shellQuote(branch)}`,
        ].join("\n"),
        {
          name: "create workspace branch",
        },
      );

      await local.open(
        `vscode://vscode-remote/ssh-remote+${encodeURIComponent(ctx.provider.vscodeAuthority)}${ctx.steps.repoPath}?windowId=_blank`,
      );
    },
  },
});

function installVsCodeServerCommand(commit: string): string {
  const quotedCommit = shellQuote(commit);
  return [
    "set -e",
    `if [ ! -x "$HOME/.vscode-server/bin/${commit}/server.sh" ]; then`,
    `  mkdir -p "$HOME/.vscode-server/bin/${commit}"`,
    `  curl -fsSL "https://update.code.visualstudio.com/commit:${commit}/server-linux-x64/stable" | tar -xz --strip-components=1 -C "$HOME/.vscode-server/bin/${commit}"`,
    `  printf '%s\n' ${quotedCommit} > "$HOME/.vscode-server/bin/${commit}/fdev-preinstalled-commit"`,
    "fi",
  ].join("\n");
}

function localVsCodeCommit(): string | undefined {
  try {
    const result = Bun.spawnSync(["code", "--version"], {
      stdout: "pipe",
      stderr: "ignore",
    });
    if (result.exitCode !== 0) return undefined;

    const lines = new TextDecoder().decode(result.stdout).trim().split(/\r?\n/);
    const commit = lines[1]?.trim();
    return commit && /^[0-9a-f]{40}$/i.test(commit) ? commit : undefined;
  } catch {
    return undefined;
  }
}

function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index <= 0 ? "/" : path.slice(0, index);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
