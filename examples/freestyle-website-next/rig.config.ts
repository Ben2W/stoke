import { cmux, type CmuxRuntime } from "@rigkit/provider-cmux";
import { freestyle } from "@rigkit/provider-freestyle";
import type {
  FreestyleVmRuntime,
  FreestyleVmSnapshotRef,
} from "@rigkit/provider-freestyle";
import { env, workflow } from "@rigkit/sdk";

const repo = "freestyle-sh/freestyle-website-next";
const repoUrl = `https://github.com/${repo}.git`;
const repoPath = "/workspace/freestyle-website-next";
const devPort = 4321;
const devCommand = `bun run dev -- --host 0.0.0.0 --port ${devPort}`;

const vmImage = `
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV BUN_INSTALL=/opt/bun
ENV PATH="/opt/bun/bin:$PATH"

RUN apt-get update -qq \\
  && apt-get install -y -qq \\
    build-essential \\
    ca-certificates \\
    curl \\
    git \\
    gnupg \\
    pkg-config \\
    python3 \\
    unzip \\
    xz-utils \\
  && mkdir -p /etc/apt/keyrings \\
  && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \\
  && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \\
  && printf 'deb [arch=%s signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main\\n' "$(dpkg --print-architecture)" > /etc/apt/sources.list.d/github-cli.list \\
  && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \\
  && apt-get update -qq \\
  && apt-get install -y -qq gh nodejs \\
  && corepack enable \\
  && curl -fsSL https://bun.sh/install | HOME=/root BUN_INSTALL=/opt/bun bash \\
  && ln -sf /opt/bun/bin/bun /usr/local/bin/bun \\
  && git config --global init.defaultBranch main \\
  && rm -rf /var/lib/apt/lists/*
`;

type VmContext = {
  vm: FreestyleVmSnapshotRef;
};

const app = workflow("freestyle-website-next", {
  providers: {
    freestyle: freestyle.provider({
      apiKey: env("FREESTYLE_API_KEY"),
      image: vmImage,
    }),
    terminal: freestyle.terminal(),
    cmux: cmux.provider(),
  },
});

const baseVm = app.sequence("base-vm").task("create", async ({ freestyle }) => {
  const vm = await freestyle.vms.create();
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
    await vm.exec(`cd ${shellQuote(ctx.repoPath)} && bun install`, {
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
    onCreated: async ({ ctx, providers, workspace }) => {
      const vm = await providers.freestyle.vms.fromSnapshot(ctx.repo.vm);
      workspace.setResource("vm", {
        providerId: "freestyle",
        resourceId: vm.vmId,
        kind: "vm",
        sourceRef: ctx.repo.vm,
      });
      const branch = `rigkit/${workspace.name.replaceAll(/[^A-Za-z0-9._/-]/g, "-")}`;
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

      await openInCmux({
        name: workspace.name,
        vm,
        repoPath: ctx.repo.repoPath,
        cmux: providers.cmux,
      });

      await waitForLocalhost(vm, devPort);
    },
    onOpen: async ({ ctx, providers, workspace }) => {
      const vmResource = workspace.resources.vm;
      if (!vmResource) throw new Error(`Workspace ${workspace.name} does not have a Freestyle VM resource`);
      const vm = providers.freestyle.vms.fromId(vmResource.resourceId);
      await openInCmux({
        name: workspace.name,
        vm,
        repoPath: ctx.repo.repoPath,
        cmux: providers.cmux,
      });
    },
  });

async function openInCmux(input: {
  name: string;
  vm: FreestyleVmRuntime;
  repoPath: string;
  cmux: CmuxRuntime;
}): Promise<void> {
  await input.cmux.open({
    name: input.name,
    ssh: await input.vm.ssh(),
    cwd: input.repoPath,
    command: devCommand,
    url: `http://localhost:${devPort}`,
    focus: true,
    waitForRemoteReady: {
      timeoutMs: 90 * 1000,
      requireProxy: true,
    },
  });
}

function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index <= 0 ? "/" : path.slice(0, index);
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
