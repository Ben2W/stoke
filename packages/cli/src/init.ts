import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DEFAULT_CONFIG_PATH } from "./project.ts";

export type InitProjectInput = {
  projectDir: string;
};

export type InitProjectResult = {
  projectDir: string;
  configPath: string;
  created: {
    config: boolean;
  };
};

export function initProject(input: InitProjectInput): InitProjectResult {
  const configPath = join(input.projectDir, DEFAULT_CONFIG_PATH);
  mkdirSync(input.projectDir, { recursive: true });
  mkdirSync(dirname(configPath), { recursive: true });

  if (existsSync(configPath)) {
    throw new Error(`${configPath} already exists.`);
  }

  writeFileSync(configPath, starterConfig());

  return {
    projectDir: input.projectDir,
    configPath,
    created: {
      config: true,
    },
  };
}

export function starterConfig(): string {
  const workflowName = JSON.stringify("dev");

  return `import { workflow } from "@rigkit/sdk";
import { cmux } from "@rigkit/provider-cmux";
import { freestyle, VmBaseImage, VmSpec } from "@rigkit/provider-freestyle";

const repo = "octocat/Hello-World";
const repoPath = "/workspace/Hello-World";
const vmHome = "/root";
const vmIdleTimeoutSeconds = 3600;
const vmSpec = new VmSpec()
  .baseImage(new VmBaseImage("FROM node:22"))
  .runCommands(
    \`
set -e
export DEBIAN_FRONTEND=noninteractive

apt-get update -qq
apt-get install -y -qq ca-certificates curl git gnupg openssh-client
mkdir -p /etc/apt/keyrings

curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli-archive-keyring.gpg
chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
printf 'deb [arch=%s signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main\\\\n' "$(dpkg --print-architecture)" > /etc/apt/sources.list.d/github-cli.list

apt-get update -qq
apt-get install -y -qq gh

git config --system init.defaultBranch main
gh --version
rm -rf /var/lib/apt/lists/*
\`,
  )
  .idleTimeoutSeconds(vmIdleTimeoutSeconds);

const freestyleProvider = freestyle.provider();

export const dev = workflow(${workflowName}, {
  providers: {
    freestyle: freestyleProvider,
    terminal: freestyle.terminal(),
    cmux: cmux.provider(),
  },
})
  .step("create-base-vm", async ({ providers }) => {
    console.log("creating base vm");
    const { vm, vmId } = await providers.freestyle.client.vms.create({
      spec: vmSpec,
      logger: console.log,
    });
    try {
      const result = await vm.exec("node --version");
      if ((result.statusCode ?? 0) !== 0 || !result.stdout.trim().startsWith("v22.")) {
        throw new Error(\`Expected Node.js v22, got: \${result.stdout}\${result.stderr}\`);
      }
      const snapshot = await vm.snapshot();
      return { ctx: { snapshotId: snapshot.snapshotId } };
    } finally {
      await providers.freestyle.client.vms.delete({ vmId });
    }
  })
  .step("github-auth", async ({ providers, step }) => {
    const { vm, vmId } = await providers.freestyle.client.vms.create({
      snapshotId: step.ctx.snapshotId,
      idleTimeoutSeconds: vmIdleTimeoutSeconds,
      logger: console.log,
    });
    try {
      const authenticated = await vm.exec(withVmHome("gh auth status -h github.com >/dev/null 2>&1"));
      if ((authenticated.statusCode ?? 0) !== 0) {
        await providers.terminal.open("Log in to GitHub", {
          ssh: await providers.freestyle.createSSHOptions({ vmId }),
          command: "gh auth login --hostname github.com --git-protocol https --web",
          keepOpenAfterCommand: true,
          instructions: "Complete the GitHub browser login in this terminal. After gh succeeds, type exit to continue.",
        });

        const verified = await vm.exec(withVmHome("gh auth status -h github.com >/dev/null 2>&1"));
        if ((verified.statusCode ?? 0) !== 0) {
          const status = await vm.exec(withVmHome("gh auth status -h github.com 2>&1"));
          throw new Error(\`GitHub CLI is not authenticated:\\n\${status.stdout || status.stderr}\`.trim());
        }
      }

      const snapshot = await vm.snapshot();
      return { ctx: { snapshotId: snapshot.snapshotId } };
    } finally {
      await providers.freestyle.client.vms.delete({ vmId });
    }
  })
  .step("clone-hello-world", async ({ providers, step }) => {
    const { vm, vmId } = await providers.freestyle.client.vms.create({
      snapshotId: step.ctx.snapshotId,
      idleTimeoutSeconds: vmIdleTimeoutSeconds,
      logger: console.log,
    });
    try {
      const clone = await vm.exec({
        command: [
          "set -e",
          \`export HOME=\${shellQuote(vmHome)}\`,
          \`mkdir -p \${shellQuote(dirname(repoPath))}\`,
          \`rm -rf \${shellQuote(repoPath)}\`,
          \`gh repo clone \${shellQuote(repo)} \${shellQuote(repoPath)}\`,
          \`git -C \${shellQuote(repoPath)} status --short\`,
        ].join("\\n"),
        timeoutMs: 5 * 60 * 1000,
      });
      if ((clone.statusCode ?? 0) !== 0) {
        throw new Error(\`Hello-World clone failed:\\n\${clone.stdout ?? ""}\${clone.stderr ?? ""}\`.trim());
      }

      const snapshot = await vm.snapshot();
      return { ctx: { snapshotId: snapshot.snapshotId, repoPath } };
    } finally {
      await providers.freestyle.client.vms.delete({ vmId });
    }
  })
  .workspace({
    create: async ({ workflow, providers }) => {
      console.log("booting workspace vm");
      const { vmId } = await providers.freestyle.client.vms.create({
        snapshotId: workflow.ctx.snapshotId,
        idleTimeoutSeconds: vmIdleTimeoutSeconds,
        logger: console.log,
      });
      return {
        vmId,
        repoPath: workflow.ctx.repoPath,
      };
    },
    remove: async ({ providers, workspace }) => {
      await providers.freestyle.client.vms.delete({ vmId: workspace.ctx.vmId });
    },
  })
  .workspaceOperation("open-cmux", {
    title: "Open cmux",
    description: "Open the workspace in cmux",
    run: async ({ providers, workspace }) => {
      await providers.cmux.open({
        name: workspace.name,
        ssh: await providers.freestyle.cmux.createSshOptions({
          vmId: workspace.ctx.vmId,
        }),
        cwd: workspace.ctx.repoPath,
        surfaceLayout: "tabs",
        terminals: [
          { command: "git status && exec bash -l" },
        ],
        focus: true,
      });
    },
  })
  .workspaceOperation("open-vscode", {
    title: "Open VS Code",
    description: "Open the workspace in VS Code",
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
      await providers.terminal.open(\`SSH \${workspace.name}\`, {
        ssh: await providers.freestyle.createSSHOptions({
          vmId: workspace.ctx.vmId,
        }),
        command: \`cd \${shellQuote(workspace.ctx.repoPath)} && exec bash -l\`,
        keepOpenAfterCommand: true,
        instructions: "Exit the SSH session when you are done.",
      });
    },
  });

function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index <= 0 ? "/" : path.slice(0, index);
}

function withVmHome(command: string): string {
  return \`HOME=\${shellQuote(vmHome)} \${command}\`;
}

function shellQuote(value: string): string {
  return \`'\${value.replaceAll("'", \`'\\\\''\`)}'\`;
}
`;
}
