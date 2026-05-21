import { cmux } from "@rigkit/provider-cmux";
import {
  freestyle,
  VmBaseImage,
  VmSpec,
  type FreestyleSdkVm,
} from "@rigkit/provider-freestyle";
import { workflow } from "@rigkit/sdk";

const repo = "freestyle-sh/freestyle-website-next";
const repoUrl = `https://github.com/${repo}.git`;
const repoPath = "/workspace/freestyle-website-next";
const devPort = 4321;
const devEnvironmentPath =
  "/usr/local/bin:/root/.local/bin:/opt/bun/bin:/root/.cargo/bin:/usr/bin:/bin:/usr/sbin:/sbin";
const devCommand = `/usr/local/bin/bun run dev -- --host 0.0.0.0 --port ${devPort}`;
const devSessionName = "website-dev";
const vmIdleTimeoutSeconds = 600;
const vmHome = "/root";
const shpoolVersion = "0.10.0";
const shpoolSocketPath = `${vmHome}/.local/run/shpool/${devSessionName}.socket`;

const vmSpec = new VmSpec()
  .baseImage(new VmBaseImage("FROM node:22"))
  .runCommands(
    `
set -e
export DEBIAN_FRONTEND=noninteractive

apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg
mkdir -p /etc/apt/keyrings

curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli-archive-keyring.gpg
chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
printf 'deb [arch=%s signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main\\n' "$(dpkg --print-architecture)" > /etc/apt/sources.list.d/github-cli.list

apt-get update -qq
apt-get install -y -qq build-essential ca-certificates curl gh git gnupg pkg-config python3 unzip xz-utils

corepack enable
export HOME=/root
export PATH="/usr/local/bin:/root/.local/bin:/opt/bun/bin:$PATH"
npm config set prefix /usr/local

curl -fsSL https://bun.sh/install | BUN_INSTALL=/opt/bun bash &
bun_pid=$!

npm install -g @openai/codex &
codex_pid=$!

wait "$bun_pid"
wait "$codex_pid"

curl --proto '=https' --tlsv1.2 -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain 1.85.0
. /root/.cargo/env
cargo install shpool --locked --version ${shpoolVersion}

ln -sf /opt/bun/bin/bun /usr/local/bin/bun
ln -sf /root/.cargo/bin/shpool /usr/local/bin/shpool
mkdir -p /root/.codex
printf 'cli_auth_credentials_store = "file"\\n' > /root/.codex/config.toml
git config --system init.defaultBranch main
bun --version
codex --version
shpool version

rm -rf /var/lib/apt/lists/*
`,
  )
  .idleTimeoutSeconds(vmIdleTimeoutSeconds)
  .snapshot();

const app = workflow("freestyle-website-next");
const freestyleProvider = freestyle.provider();
const terminalProvider = freestyle.terminal();

const websiteSetup = app
  .sequence("website-setup")
  .addProvider("freestyle", freestyleProvider)
  .addProvider("terminal", terminalProvider)
  .task("install-dependencies", async ({ providers }) => {
    const { vm, vmId } = await providers.freestyle.client.vms.create({
      spec: vmSpec,
      logger: console.log,
    });
    try {
      const snapshot = await vm.snapshot();
      return { ctx: { snapshotId: snapshot.snapshotId } };
    } finally {
      await providers.freestyle.client.vms.delete({ vmId });
    }
  })
  .configure({ snapshotId: { scope: "workflow" } })
  .task(
    "github-auth",
    { version: "github-auth-root-v6" },
    async ({ step, providers }) => {
      const created = await providers.freestyle.client.vms.create({
        snapshotId: step.ctx.snapshotId,
        idleTimeoutSeconds: vmIdleTimeoutSeconds,
        logger: console.log,
      });
      const { vmId } = created;
      const { vm } = created;
      try {
        const authenticated = await vm.exec(
          withVmHome("gh auth status -h github.com >/dev/null 2>&1"),
        );
        if ((authenticated.statusCode ?? 0) !== 0) {
          await providers.terminal.open("Log in to GitHub", {
            ssh: await providers.freestyle.createSSHOptions({ vmId }),
            command:
              "gh auth login --hostname github.com --git-protocol https --web",
            keepOpenAfterCommand: true,
            instructions:
              "Complete the GitHub device/browser login in this terminal. After gh succeeds, inspect the shell if needed, then type exit.",
          });

          const verified = await vm.exec(
            withVmHome("gh auth status -h github.com >/dev/null 2>&1"),
          );
          if ((verified.statusCode ?? 0) !== 0) {
            const status = await vm.exec(
              withVmHome("gh auth status -h github.com 2>&1"),
            );
            throw new Error(
              `GitHub CLI is not authenticated:\n${status.stdout || status.stderr}`.trim(),
            );
          }
        }

        console.log("configuring Git author identity from GitHub account");
        const gitIdentity = await vm.exec({
          command: configureGitIdentityCommand(),
          timeoutMs: 60 * 1000,
        });
        if ((gitIdentity.statusCode ?? 0) !== 0) {
          throw new Error(
            `Git author identity configuration failed:\n${gitIdentity.stdout ?? ""}${gitIdentity.stderr ?? ""}`.trim(),
          );
        }

        const snapshot = await vm.snapshot();
        return { ctx: { snapshotId: snapshot.snapshotId } };
      } finally {
        await providers.freestyle.client.vms.delete({ vmId });
      }
    },
  )
  .task("clone-and-install", async ({ step, providers }) => {
    const created = await providers.freestyle.client.vms.create({
      snapshotId: step.ctx.snapshotId,
      idleTimeoutSeconds: vmIdleTimeoutSeconds,
      logger: console.log,
    });
    const { vmId } = created;
    const { vm } = created;
    try {
      const cloned = await vm.exec(`test -d ${shellQuote(repoPath + "/.git")}`);

      if ((cloned.statusCode ?? 0) !== 0) {
        console.log("cloning website repo");
        const clone = await vm.exec({
          command: [
            "set -e",
            `export HOME=${shellQuote(vmHome)}`,
            `mkdir -p ${shellQuote(dirname(repoPath))}`,
            `gh repo clone ${shellQuote(repo)} ${shellQuote(repoPath)}`,
          ].join("\n"),
          timeoutMs: 5 * 60 * 1000,
        });
        if ((clone.statusCode ?? 0) !== 0) {
          throw new Error(
            `website repo clone failed:\n${clone.stdout ?? ""}${clone.stderr ?? ""}`.trim(),
          );
        }
      }

      console.log("installing website dependencies");
      const install = await vm.exec({
        command: [
          "set -e",
          `export HOME=${shellQuote(vmHome)}`,
          `cd ${shellQuote(repoPath)}`,
          `git remote set-url origin ${shellQuote(repoUrl)}`,
          "git fetch --prune origin",
          "git config --global --add safe.directory " + shellQuote(repoPath),
          "bun install",
        ].join("\n"),
        timeoutMs: 10 * 60 * 1000,
      });
      if ((install.statusCode ?? 0) !== 0) {
        throw new Error(
          `website dependency install failed:\n${install.stdout ?? ""}${install.stderr ?? ""}`.trim(),
        );
      }

      const snapshot = await vm.snapshot();
      return {
        ctx: {
          snapshotId: snapshot.snapshotId,
          repoPath,
          repo,
          devCommand,
          devSessionName,
          devPort,
        },
      };
    } finally {
      await providers.freestyle.client.vms.delete({ vmId });
    }
  })
  .task(
    "initialize-codex-cli",
    { version: "codex-cli-initialization-v1" },
    async ({ step, providers }) => {
      const created = await providers.freestyle.client.vms.create({
        snapshotId: step.ctx.snapshotId,
        idleTimeoutSeconds: vmIdleTimeoutSeconds,
        logger: console.log,
      });
      const { vmId } = created;
      const { vm } = created;
      try {
        await providers.terminal.open("Initialize Codex CLI", {
          ssh: await providers.freestyle.createSSHOptions({ vmId }),
          command: agentCliInitCommand("codex"),
          keepOpenAfterCommand: true,
          instructions:
            "Codex CLI is running inside the cloned website repo. Complete the login and workspace trust prompts, then exit Codex or click Complete task.",
        });

        const snapshot = await vm.snapshot();
        return {
          ctx: {
            ...step.ctx,
            snapshotId: snapshot.snapshotId,
          },
        };
      } finally {
        await providers.freestyle.client.vms.delete({ vmId });
      }
    },
  )
  .task(
    "run-dev-server",
    { version: "shpool-dev-server-v2" },
    async ({ step, providers }) => {
      const created = await providers.freestyle.client.vms.create({
        snapshotId: step.ctx.snapshotId,
        idleTimeoutSeconds: vmIdleTimeoutSeconds,
        logger: console.log,
      });
      const { vmId } = created;
      const { vm } = created;
      try {
        console.log("starting website dev server in shpool");
        const started = await vm.exec({
          command: startDevServerSessionCommand({
            repoPath: step.ctx.repoPath,
            command: step.ctx.devCommand,
            sessionName: step.ctx.devSessionName,
          }),
          timeoutMs: 60 * 1000,
        });
        if ((started.statusCode ?? 0) !== 0) {
          throw new Error(
            `website dev server session failed to start:\n${started.stdout ?? ""}${started.stderr ?? ""}`.trim(),
          );
        }

        await waitForLocalhostHtml(vm, step.ctx.devPort);

        const snapshot = await vm.snapshot();
        return {
          ctx: {
            ...step.ctx,
            snapshotId: snapshot.snapshotId,
          },
        };
      } finally {
        await providers.freestyle.client.vms.delete({ vmId });
      }
    },
  );

export const freestyleWebsiteNext = app
  .sequence("website")
  .add(websiteSetup)
  .addProvider("freestyle", freestyleProvider)
  .addProvider("terminal", terminalProvider)
  .workspace({
    create: async ({ workflow, providers, workspace }) => {
      const created = await providers.freestyle.client.vms.create({
        snapshotId: workflow.ctx.snapshotId,
        idleTimeoutSeconds: vmIdleTimeoutSeconds,
        logger: console.log,
      });
      const { vmId } = created;
      const { vm } = created;
      try {
        const branch = `rigkit/${workspace.name.replaceAll(/[^A-Za-z0-9._/-]/g, "-")}`;
        const result = await vm.exec(
          [
            "set -e",
            `cd ${shellQuote(workflow.ctx.repoPath)}`,
            `git switch -C ${shellQuote(branch)}`,
          ].join("\n"),
        );
        if ((result.statusCode ?? 0) !== 0) {
          throw new Error(
            `workspace branch creation failed:\n${result.stdout ?? ""}${result.stderr ?? ""}`.trim(),
          );
        }
        await waitForLocalhostHtml(vm, workflow.ctx.devPort);
        return {
          vmId,
          repoPath: workflow.ctx.repoPath,
          repo: workflow.ctx.repo,
          branch,
          devCommand: workflow.ctx.devCommand,
          devSessionName: workflow.ctx.devSessionName,
          devPort: workflow.ctx.devPort,
        };
      } catch (error) {
        await providers.freestyle.client.vms.delete({ vmId });
        throw error;
      }
    },
    remove: async ({ providers, workspace }) => {
      await providers.freestyle.client.vms.delete({ vmId: workspace.ctx.vmId });
    },
  })
  .addProvider("cmux", cmux.provider())
  .workspaceOperation("open-cmux", {
    title: "Open cmux",
    description: "Open the website workspace in cmux",
    run: async ({ providers, workspace }) => {
      const cmuxWorkspace = await providers.cmux.ssh({
        ...(await providers.freestyle.cmux.createSshOptions({
          vmId: workspace.ctx.vmId,
        })),
        name: workspace.name,
      });
      await providers.cmux.newSurface({
        workspace: cmuxWorkspace.workspaceId,
        type: "browser",
        url: `http://localhost:${workspace.ctx.devPort}`,
        focus: true,
      });
      const devTerminal = await providers.cmux.newSurface({
        workspace: cmuxWorkspace.workspaceId,
        type: "terminal",
        focus: false,
      });
      await providers.cmux.send({
        workspace: cmuxWorkspace.workspaceId,
        surface: devTerminal.surfaceId,
        text: `${attachDevServerSessionCommand(workspace.ctx.devSessionName)}\n`,
      });
      const codexTerminal = await providers.cmux.newSurface({
        workspace: cmuxWorkspace.workspaceId,
        type: "terminal",
        focus: false,
      });
      await providers.cmux.send({
        workspace: cmuxWorkspace.workspaceId,
        surface: codexTerminal.surfaceId,
        text: `cd ${shellQuote(workspace.ctx.repoPath)} && codex\n`,
      });
      await providers.cmux.selectWorkspace(cmuxWorkspace.workspaceId);
    },
  })
  .workspaceOperation("open-vscode", {
    title: "Open VS Code",
    description: "Open the website workspace in VS Code",
    run: async ({ providers, workspace, local }) => {
      const url = await providers.freestyle.vscode.createUrl({
        vmId: workspace.ctx.vmId,
        cwd: workspace.ctx.repoPath,
      });
      await local.open(url);
    },
  })
  .workspaceOperation("ssh", {
    title: "SSH",
    description: "Open an interactive SSH session",
    run: async ({ providers, workspace }) => {
      await providers.terminal.open(`SSH ${workspace.name}`, {
        ssh: await providers.freestyle.createSSHOptions({
          vmId: workspace.ctx.vmId,
        }),
        command: `cd ${shellQuote(workspace.ctx.repoPath)} && exec bash -l`,
        keepOpenAfterCommand: true,
        instructions: "Exit the SSH session when you are done.",
      });
    },
  });

function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index <= 0 ? "/" : path.slice(0, index);
}

// vm.exec does not have its home directory set to the root user's home, so we need to set HOME explicitly for commands that expect it.
function withVmHome(command: string): string {
  return `HOME=${shellQuote(vmHome)} ${command}`;
}

function agentCliInitCommand(command: "codex"): string {
  return [
    "set -e",
    `export HOME=${shellQuote(vmHome)}`,
    `cd ${shellQuote(repoPath)}`,
    command,
  ].join("\n");
}

function configureGitIdentityCommand(): string {
  return [
    "set -e",
    `export HOME=${shellQuote(vmHome)}`,
    "login=$(gh api user --jq '.login')",
    "name=$(gh api user --jq '.name // empty')",
    "id=$(gh api user --jq '.id')",
    "email=$(gh api user --jq '.email // empty')",
    'if [ -z "$name" ]; then name="$login"; fi',
    'if [ -z "$email" ]; then email="${id}+${login}@users.noreply.github.com"; fi',
    'git config --global user.name "$name"',
    'git config --global user.email "$email"',
  ].join("\n");
}

function startDevServerSessionCommand(options: {
  repoPath: string;
  command: string;
  sessionName: string;
}): string {
  const shpoolClientLogPath = "/tmp/shpool-dev-server-client.log";
  const shpoolDaemonLogPath = `${vmHome}/.local/run/shpool/daemonized-shpool.log`;
  const shpool = `shpool --socket ${shellQuote(shpoolSocketPath)} --log-file ${shellQuote(shpoolClientLogPath)} -vv`;
  return [
    "set -eu",
    `export HOME=${shellQuote(vmHome)}`,
    `export PATH=${shellQuote(devEnvironmentPath)}:"$PATH"`,
    `mkdir -p ${shellQuote(`${vmHome}/.config/shpool`)}`,
    `printf '%s\\n' ${shellQuote(`initial_path = "${devEnvironmentPath}"`)} > ${shellQuote(`${vmHome}/.config/shpool/config.toml`)}`,
    "command -v shpool",
    "shpool version",
    `cd ${shellQuote(options.repoPath)}`,
    `rm -f ${shellQuote(shpoolClientLogPath)} ${shellQuote(shpoolDaemonLogPath)}`,
    `${shpool} kill ${shellQuote(options.sessionName)} >/dev/null 2>&1 || true`,
    "set +e",
    `${shpool} attach --background --force --dir ${shellQuote(options.repoPath)} --cmd ${shellQuote(options.command)} ${shellQuote(options.sessionName)}`,
    "status=$?",
    "set -e",
    'if [ "$status" -ne 0 ]; then',
    '  echo "shpool attach failed with status $status" >&2',
    `  ${shpool} list >&2 || true`,
    `  if [ -f ${shellQuote(shpoolClientLogPath)} ]; then`,
    '    echo "shpool client log:" >&2',
    `    sed -n '1,240p' ${shellQuote(shpoolClientLogPath)} >&2`,
    "  fi",
    `  if [ -f ${shellQuote(shpoolDaemonLogPath)} ]; then`,
    '    echo "shpool daemon log:" >&2',
    `    sed -n '1,240p' ${shellQuote(shpoolDaemonLogPath)} >&2`,
    "  fi",
    '  exit "$status"',
    "fi",
    `${shpool} list`,
  ].join("\n");
}

function attachDevServerSessionCommand(sessionName: string): string {
  return [
    "set -e",
    `export HOME=${shellQuote(vmHome)}`,
    `export PATH=${shellQuote(devEnvironmentPath)}:"$PATH"`,
    `shpool --socket ${shellQuote(shpoolSocketPath)} list | awk 'NR > 1 {print $1}' | grep -Fxq ${shellQuote(sessionName)}`,
    `exec shpool --socket ${shellQuote(shpoolSocketPath)} attach -f ${shellQuote(sessionName)}`,
  ].join("\n");
}

async function waitForLocalhostHtml(
  vm: Pick<FreestyleSdkVm, "exec">,
  port: number,
): Promise<void> {
  const url = `http://127.0.0.1:${port}/`;
  const result = await vm.exec({
    command: [
      "set -e",
      "tmp_dir=$(mktemp -d)",
      "trap 'rm -rf \"$tmp_dir\"' EXIT",
      "for attempt in $(seq 1 120); do",
      `  if curl -fsS --max-time 5 -o "$tmp_dir/body" ${shellQuote(url)} >/dev/null 2>&1; then`,
      `    if grep -Eiq '<!doctype html|<html[[:space:]>]' "$tmp_dir/body"; then`,
      "      exit 0",
      "    fi",
      "  fi",
      "  sleep 1",
      "done",
      `curl -i -sS --max-time 10 ${shellQuote(url)} | sed -n '1,80p' || true`,
      "exit 1",
    ].join("\n"),
    timeoutMs: 125 * 1000,
  });
  if ((result.statusCode ?? 0) !== 0) {
    throw new Error(
      `Dev server did not return HTML on localhost:${port}\n${result.stdout}${result.stderr}`.trim(),
    );
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
