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
const devCommand = `bun run dev -- --host 0.0.0.0 --port ${devPort}`;
const vmIdleTimeoutSeconds = 3600;

const vmBaseImage = new VmBaseImage("FROM ubuntu:24.04")
  .appendDockerfile(`
ENV DEBIAN_FRONTEND=noninteractive
ENV BUN_INSTALL=/opt/bun
ENV PATH="/opt/bun/bin:$PATH"
`)
  .runCommands(`
set -e
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg
mkdir -p /etc/apt/keyrings
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli-archive-keyring.gpg
chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
printf 'deb [arch=%s signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main\\n' "$(dpkg --print-architecture)" > /etc/apt/sources.list.d/github-cli.list
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
rm -rf /var/lib/apt/lists/*
`);

const vmSpec = new VmSpec()
  .baseImage(vmBaseImage)
  .aptDeps(
    "build-essential",
    "ca-certificates",
    "curl",
    "gh",
    "git",
    "gnupg",
    "nodejs",
    "pkg-config",
    "python3",
    "unzip",
    "xz-utils",
  )
  .runCommands(
    "corepack enable",
    "curl -fsSL https://bun.sh/install | HOME=/root BUN_INSTALL=/opt/bun bash",
    "ln -sf /opt/bun/bin/bun /usr/local/bin/bun",
    "git config --system init.defaultBranch main",
  )
  .memSizeGb(16)
  .vcpuCount(4)
  .rootfsSizeGb(24)
  .idleTimeoutSeconds(vmIdleTimeoutSeconds);

const app = workflow("freestyle-website-next", {
  providers: {
    freestyle: freestyle.provider(),
    terminal: freestyle.terminal(),
    cmux: cmux.provider(),
  },
});

const websiteSetup = app
  .sequence("website-setup")
  .task("install-dependencies", async ({ freestyle, step }) => {
    const { vm, vmId } = await freestyle.client.vms.create({
      spec: vmSpec,
      logger: step.log,
    });
    try {
      const snapshot = await vm.snapshot();
      return { snapshotId: snapshot.snapshotId };
    } finally {
      await freestyle.client.vms.delete({ vmId });
    }
  })
  .task("github-auth", async ({ ctx, freestyle, terminal, step }) => {
    const { vm, vmId } = await freestyle.client.vms.create({
      snapshotId: ctx.snapshotId,
      idleTimeoutSeconds: vmIdleTimeoutSeconds,
      logger: step.log,
    });
    try {
      const authenticated = await vm.exec("gh auth status -h github.com >/dev/null 2>&1");
      if ((authenticated.statusCode ?? 0) !== 0) {
        await terminal.open("Log in to GitHub", {
          ssh: await freestyle.createSSHOptions({ vmId }),
          command:
            "gh auth login --hostname github.com --git-protocol https --web",
          instructions:
            "Complete the GitHub device/browser login in this terminal. Click Finished after gh reports that authentication succeeded.",
        });

        const verified = await vm.exec("gh auth status -h github.com >/dev/null 2>&1");
        if ((verified.statusCode ?? 0) !== 0) {
          const status = await vm.exec("gh auth status -h github.com 2>&1");
          throw new Error(
            `GitHub CLI is not authenticated:\n${status.stdout || status.stderr}`.trim(),
          );
        }
      }

      const snapshot = await vm.snapshot();
      return { snapshotId: snapshot.snapshotId };
    } finally {
      await freestyle.client.vms.delete({ vmId });
    }
  })
  .task("clone-and-install", async ({ ctx, freestyle, step }) => {
    const { vm, vmId } = await freestyle.client.vms.create({
      snapshotId: ctx.snapshotId,
      idleTimeoutSeconds: vmIdleTimeoutSeconds,
      logger: step.log,
    });
    try {
      const cloned = await vm.exec(`test -d ${shellQuote(repoPath + "/.git")}`);

      if ((cloned.statusCode ?? 0) !== 0) {
        step.log("cloning website repo");
        const clone = await vm.exec({
          command: [
            "set -e",
            `mkdir -p ${shellQuote(dirname(repoPath))}`,
            `gh repo clone ${shellQuote(repo)} ${shellQuote(repoPath)}`,
          ].join("\n"),
          timeoutMs: 5 * 60 * 1000,
        });
        if ((clone.statusCode ?? 0) !== 0) {
          throw new Error(`website repo clone failed:\n${clone.stdout ?? ""}${clone.stderr ?? ""}`.trim());
        }
      }

      step.log("installing website dependencies");
      const install = await vm.exec({
        command: [
          "set -e",
          `cd ${shellQuote(repoPath)}`,
          `git remote set-url origin ${shellQuote(repoUrl)}`,
          "git fetch --prune origin",
          "git config --global --add safe.directory " + shellQuote(repoPath),
          "bun install",
        ].join("\n"),
        timeoutMs: 10 * 60 * 1000,
      });
      if ((install.statusCode ?? 0) !== 0) {
        throw new Error(`website dependency install failed:\n${install.stdout ?? ""}${install.stderr ?? ""}`.trim());
      }

      const snapshot = await vm.snapshot();
      return {
        snapshotId: snapshot.snapshotId,
        repoPath,
        repo,
        devCommand,
        devPort,
      };
    } finally {
      await freestyle.client.vms.delete({ vmId });
    }
  });

export default app
  .sequence("website")
  .add(websiteSetup)
  .workspace({
    create: async ({ workflow, providers, workspace, step }) => {
      const { vm, vmId } = await providers.freestyle.client.vms.create({
        snapshotId: workflow.ctx.snapshotId,
        idleTimeoutSeconds: vmIdleTimeoutSeconds,
        logger: step.log,
      });
      try {
        const branch = `rigkit/${workspace.name.replaceAll(/[^A-Za-z0-9._/-]/g, "-")}`;
        const result = await vm.exec([
          "set -e",
          `cd ${shellQuote(workflow.ctx.repoPath)}`,
          `git switch -C ${shellQuote(branch)}`,
        ].join("\n"));
        if ((result.statusCode ?? 0) !== 0) {
          throw new Error(`workspace branch creation failed:\n${result.stdout ?? ""}${result.stderr ?? ""}`.trim());
        }
        return {
          vmId,
          repoPath: workflow.ctx.repoPath,
          repo: workflow.ctx.repo,
          branch,
          devPort,
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
  .workspaceOperation("open-cmux", {
    title: "Open cmux",
    description: "Open the website workspace in cmux",
    run: async ({ providers, workspace }) => {
      const vm = providers.freestyle.client.vms.ref({ vmId: workspace.ctx.vmId });
      await providers.cmux.open({
        name: workspace.name,
        ssh: await providers.freestyle.cmux.createSshOptions({
          vmId: workspace.ctx.vmId,
        }),
        cwd: workspace.ctx.repoPath,
        command: devCommand,
        url: `http://localhost:${devPort}`,
        focus: true,
        waitForRemoteReady: {
          timeoutMs: 90 * 1000,
          requireProxy: true,
        },
      });
      await waitForLocalhost(vm, devPort);
    },
  });

function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index <= 0 ? "/" : path.slice(0, index);
}

async function waitForLocalhost(
  vm: Pick<FreestyleSdkVm, "exec">,
  port: number,
): Promise<void> {
  const result = await vm.exec({
    command: [
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
    timeoutMs: 125 * 1000,
  });
  if ((result.statusCode ?? 0) !== 0) {
    throw new Error(
      `Dev server did not start on localhost:${port}\n${result.stdout}${result.stderr}`.trim(),
    );
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
