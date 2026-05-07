import { createCmuxClient } from "@freestyle-sh/fdev-cmux";
import { env, workflow } from "@freestyle-sh/fdev-sdk";
import { freestyle } from "@freestyle-sh/fdev-provider-freestyle";
import type {
  FreestyleVmRuntime,
  FreestyleVmSnapshotRef,
  FreestyleWorkspaceContext,
} from "@freestyle-sh/fdev-provider-freestyle";

const repo = "freestyle-sh/freestyle-website-next";
const repoUrl = `https://github.com/${repo}.git`;
const repoPath = "/workspace/freestyle-website-next";
const devPort = 4321;
const devCommand = `pnpm dev -- --host 0.0.0.0 --port ${devPort}`;
const pnpmVersion = "9.15.9";
const cmux = createCmuxClient();

type VmContext = {
  vm: FreestyleVmSnapshotRef;
};

const app = workflow("freestyle-website-next", {
  providers: {
    freestyle: freestyle.provider({
      apiKey: env("FREESTYLE_API_KEY"),
      image: "ubuntu-24.04",
    }),
    terminal: freestyle.terminal(),
  },
});

const baseVm = app
  .sequence("base-vm")
  .task("create", async ({ freestyle }) => {
    const vm = await freestyle.vms.create();
    return { vm: await vm.snapshotRef() };
  })
  .task("install-toolchain", async ({ ctx, freestyle }) => {
    const vm = await freestyle.vms.fromSnapshot(ctx.vm);
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
        'export HOME="${HOME:-/root}"',
        'mkdir -p "$HOME"',
        'if [ ! -x /opt/bun/bin/bun ]; then curl -fsSL https://bun.sh/install | HOME="$HOME" BUN_INSTALL=/opt/bun bash; fi',
        "ln -sf /opt/bun/bin/bun /usr/local/bin/bun",
        "git config --global init.defaultBranch main",
        "bun --version",
      ].join("\n"),
      {
        name: "install bun",
        timeoutMs: 5 * 60 * 1000,
      },
    );

    return { vm: await vm.snapshotRef() };
  })
  .task("install-node-pnpm", async ({ ctx, freestyle }) => {
    const vm = await freestyle.vms.fromSnapshot(ctx.vm);
    await vm.exec(
      [
        "set -e",
        "export DEBIAN_FRONTEND=noninteractive",
        'node_major="$(node -p \'process.versions.node.split(\".\")[0]\' 2>/dev/null || printf 0)"',
        'if [ "$node_major" -lt 20 ]; then',
        "  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -",
        "  apt-get install -y -qq nodejs",
        "fi",
        "corepack enable",
        `corepack prepare pnpm@${pnpmVersion} --activate || npm install -g pnpm@${pnpmVersion}`,
        "node --version",
        "pnpm --version",
      ].join("\n"),
      {
        name: "install node and pnpm",
        timeoutMs: 10 * 60 * 1000,
      },
    );

    return { vm: await vm.snapshotRef() };
  });

const repoSetup = app
  .sequence<VmContext>("repo")
  .task("github-auth", async ({ ctx, freestyle, terminal }) => {
    const vm = await freestyle.vms.fromSnapshot(ctx.vm);
    const authenticated = await vm.probe(
      "gh auth status -h github.com >/dev/null 2>&1",
      {
        name: "check github auth",
      },
    );
    if (!authenticated.ok) {
      await terminal.open("Log in to GitHub", {
        target: vm,
        command:
          "gh auth login --hostname github.com --git-protocol https --web",
        instructions:
          "Complete the GitHub device/browser login in this terminal. Click Finished after gh reports that authentication succeeded.",
      });

      const verified = await vm.probe(
        "gh auth status -h github.com >/dev/null 2>&1",
        {
          name: "verify github auth",
        },
      );
      if (!verified.ok) {
        const status = await vm.probe("gh auth status -h github.com 2>&1", {
          name: "explain github auth",
        });
        throw new Error(
          `GitHub CLI is not authenticated:\n${status.stdout || status.stderr}`.trim(),
        );
      }
    }

    return { vm: await vm.snapshotRef() };
  })
  .task("clone", async ({ ctx, freestyle }) => {
    const vm = await freestyle.vms.fromSnapshot(ctx.vm);
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
      vm: await vm.snapshotRef(),
    };
  })
  .task("install", async ({ ctx, freestyle }) => {
    const vm = await freestyle.vms.fromSnapshot(ctx.vm);
    await vm.exec(`cd ${shellQuote(ctx.repoPath)} && pnpm install`, {
      name: "install website dependencies",
      timeoutMs: 10 * 60 * 1000,
    });

    return {
      devCommand,
      devPort,
      vm: await vm.snapshotRef(),
    };
  });

export default app
  .sequence("website")
  .add(baseVm)
  .parallel({
    repo: repoSetup,
  })
  .workspace({
    source: (ctx) => ctx.repo.vm,
    cwd: (ctx) => ctx.repo.repoPath,
    ports: [devPort],
    onCreated: async ({ ctx, providerContext, providers, workspace }) => {
      const freestyleContext = providerContext as FreestyleWorkspaceContext;
      const vm = providers.freestyle.vms.fromWorkspace(workspace);
      const branch = `fdev/${workspace.name.replaceAll(/[^A-Za-z0-9._/-]/g, "-")}`;
      await vm.exec(
        [
          "set -e",
          `cd ${shellQuote(ctx.repo.repoPath)}`,
          `git switch -C ${shellQuote(branch)}`,
        ].join("\n"),
        {
          name: "create workspace branch",
        },
      );

      const cmuxWorkspace = await cmux.ssh({
        destination: cmuxSshDestination(freestyleContext),
        name: workspace.name,
        port: freestyleContext.ssh.port,
        sshOptions: cmuxSshOptions(freestyleContext),
      });
      const cmuxWorkspaceId = cmuxWorkspace.id ?? cmuxWorkspace.handle;

      const devPane = await cmux.newPane({
        workspace: cmuxWorkspaceId,
        type: "terminal",
        direction: "down",
        focus: true,
      });
      await cmux.send({
        workspace: cmuxWorkspaceId,
        surface: devPane.surface,
        text: `cd ${shellQuote(ctx.repo.repoPath)} && ${devCommand}\\n`,
      });

      await Promise.all([
        waitForLocalhost(vm, devPort),
        cmux.waitForRemoteReady(cmuxWorkspaceId, {
          timeoutMs: 90 * 1000,
          requireProxy: true,
        }),
      ]);

      await cmux.portsKick({
        workspace: cmuxWorkspaceId,
        surface: devPane.surface,
        reason: "refresh",
      });

      await cmux.browserOpen({
        workspace: cmuxWorkspaceId,
        url: `http://localhost:${devPort}`,
        focus: true,
      });
      await cmux.selectWorkspace(cmuxWorkspaceId);
    },
  });

function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index <= 0 ? "/" : path.slice(0, index);
}

export function cmuxSshDestination(context: FreestyleWorkspaceContext): string {
  const { ssh } = context;
  if (ssh.auth.type === "token") {
    return `${ssh.username},${ssh.auth.token}@${ssh.host}`;
  }
  return `${ssh.username}@${ssh.host}`;
}

export function cmuxSshOptions(context: FreestyleWorkspaceContext): string[] {
  if (context.ssh.auth.type !== "token") return [];
  return [
    "StrictHostKeyChecking=no",
    "UserKnownHostsFile=/dev/null",
    "LogLevel=ERROR",
    "IdentitiesOnly=yes",
    "IdentityFile=/dev/null",
  ];
}

async function waitForLocalhost(
  vm: Pick<FreestyleVmRuntime, "probe">,
  port: number,
): Promise<void> {
  const result = await vm.probe(
    [
      "set -e",
      "for attempt in $(seq 1 120); do",
      `  if curl -sS -o /dev/null ${shellQuote(`http://127.0.0.1:${port}/`)} >/dev/null 2>&1; then`,
      "    exit 0",
      "  fi",
      "  sleep 1",
      "done",
      `curl -v ${shellQuote(`http://127.0.0.1:${port}/`)} || true`,
      "exit 1",
    ].join("\n"),
    {
      name: `wait for localhost:${port}`,
      timeoutMs: 125 * 1000,
    },
  );
  if (!result.ok) {
    throw new Error(
      `Dev server did not start on localhost:${port}\n${result.stdout}${result.stderr}`.trim(),
    );
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
