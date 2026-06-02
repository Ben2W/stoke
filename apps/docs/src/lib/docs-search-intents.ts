export const docsSearchIntentNames = [
  "cli.authenticate",
  "cli.gitCommands",
  "cli.install",
  "cli.vmCommands",
  "domains.checkDns",
  "domains.completeVerification",
  "domains.createMapping",
  "domains.createVerification",
  "domains.deleteMapping",
  "domains.routeTraffic",
  "domains.verifyDomain",
  "git.authenticateNativeGit",
  "git.cloneRepository",
  "git.createGithubApp",
  "git.createRepository",
  "git.createWebhookTrigger",
  "git.deleteRepository",
  "git.githubSync",
  "git.linkGithubRepository",
  "git.listRepositories",
  "git.readFiles",
  "git.searchCode",
  "git.useCli",
  "quickstart.createVm",
  "quickstart.install",
  "vms.attachNetwork",
  "vms.clientSessions",
  "vms.cloneRepository",
  "vms.createToken",
  "vms.createVm",
  "vms.createVpc",
  "vms.createVpnSession",
  "vms.deleteVm",
  "vms.execCommand",
  "vms.lifecycle",
  "vms.listVms",
  "vms.resizeVm",
  "vms.routeWebTraffic",
  "vms.sshAccess",
  "vms.workWithFiles",
] as const;

export type DocsSearchIntentName = (typeof docsSearchIntentNames)[number];

export type DocsSearchProductArea =
  | "cli"
  | "domains"
  | "git"
  | "quickstart"
  | "vms";

export type DocsSearchIntentDefinition = {
  productArea: DocsSearchProductArea;
  aliases: readonly string[];
  priority: number;
};

export const docsSearchIntents = {
  "cli.authenticate": {
    productArea: "cli",
    aliases: ["cli auth", "authenticate cli", "freestyle login", "api key"],
    priority: 50,
  },
  "cli.gitCommands": {
    productArea: "cli",
    aliases: ["git cli", "git command", "freestyle git", "npx freestyle git"],
    priority: 64,
  },
  "cli.install": {
    productArea: "cli",
    aliases: ["install cli", "freestyle cli", "npx freestyle", "install freestyle"],
    priority: 60,
  },
  "cli.vmCommands": {
    productArea: "cli",
    aliases: ["vm cli", "vm command", "freestyle vm", "npx freestyle vm"],
    priority: 64,
  },
  "domains.checkDns": {
    productArea: "domains",
    aliases: ["check dns", "dns lookup", "dig domain"],
    priority: 40,
  },
  "domains.completeVerification": {
    productArea: "domains",
    aliases: ["complete domain verification", "finish verification", "verify txt record"],
    priority: 52,
  },
  "domains.createMapping": {
    productArea: "domains",
    aliases: ["domain mapping", "map domain", "custom domain", "route domain"],
    priority: 72,
  },
  "domains.createVerification": {
    productArea: "domains",
    aliases: ["verify domain", "domain verification", "create verification", "txt record"],
    priority: 72,
  },
  "domains.deleteMapping": {
    productArea: "domains",
    aliases: ["delete mapping", "unmap domain", "remove domain mapping"],
    priority: 48,
  },
  "domains.routeTraffic": {
    productArea: "domains",
    aliases: ["route traffic", "route domain", "send traffic to vm"],
    priority: 46,
  },
  "domains.verifyDomain": {
    productArea: "domains",
    aliases: ["verify domain", "domain dns", "domain setup"],
    priority: 68,
  },
  "git.authenticateNativeGit": {
    productArea: "git",
    aliases: ["git auth", "native git", "git token", "git clone auth"],
    priority: 62,
  },
  "git.cloneRepository": {
    productArea: "git",
    aliases: ["clone repo", "clone repository", "git clone", "native git"],
    priority: 62,
  },
  "git.createGithubApp": {
    productArea: "git",
    aliases: ["github app", "create github app", "connect github app"],
    priority: 55,
  },
  "git.createRepository": {
    productArea: "git",
    aliases: [
      "git",
      "git repo",
      "git repository",
      "create git repo",
      "create git repository",
      "create repo",
      "create repository",
      "new repo",
      "new repository",
    ],
    priority: 120,
  },
  "git.deleteRepository": {
    productArea: "git",
    aliases: ["delete repo", "delete repository", "remove repo"],
    priority: 46,
  },
  "git.createWebhookTrigger": {
    productArea: "git",
    aliases: ["git trigger", "webhook trigger", "create webhook", "repository webhook"],
    priority: 65,
  },
  "git.githubSync": {
    productArea: "git",
    aliases: ["github sync", "sync github", "connect github", "sync repository"],
    priority: 74,
  },
  "git.linkGithubRepository": {
    productArea: "git",
    aliases: ["link github repository", "connect github repository", "enable github sync"],
    priority: 62,
  },
  "git.listRepositories": {
    productArea: "git",
    aliases: ["list repos", "list repositories", "show repositories"],
    priority: 46,
  },
  "git.readFiles": {
    productArea: "git",
    aliases: ["read files", "repository contents", "get file", "read repository"],
    priority: 64,
  },
  "git.searchCode": {
    productArea: "git",
    aliases: ["search", "git search", "code search", "search code", "repo search"],
    priority: 76,
  },
  "git.useCli": {
    productArea: "git",
    aliases: ["git cli", "freestyle git create", "npx freestyle git create"],
    priority: 60,
  },
  "quickstart.createVm": {
    productArea: "quickstart",
    aliases: ["quickstart vm", "create first vm", "first vm"],
    priority: 80,
  },
  "quickstart.install": {
    productArea: "quickstart",
    aliases: ["quickstart", "install freestyle", "get started", "setup"],
    priority: 82,
  },
  "vms.attachNetwork": {
    productArea: "vms",
    aliases: ["attach vm network", "network interface", "vpc vm"],
    priority: 48,
  },
  "vms.clientSessions": {
    productArea: "vms",
    aliases: ["client session", "browser token", "client token", "end user token"],
    priority: 68,
  },
  "vms.cloneRepository": {
    productArea: "vms",
    aliases: ["clone repository in vm", "git repo in vm", "vm git repo"],
    priority: 58,
  },
  "vms.createToken": {
    productArea: "vms",
    aliases: ["ssh token", "vm token", "create token"],
    priority: 70,
  },
  "vms.createVm": {
    productArea: "vms",
    aliases: ["vm", "vms", "create vm", "new vm", "virtual machine", "create virtual machine"],
    priority: 116,
  },
  "vms.createVpc": {
    productArea: "vms",
    aliases: ["vpc", "create vpc", "private network", "vm network"],
    priority: 80,
  },
  "vms.createVpnSession": {
    productArea: "vms",
    aliases: ["vpn", "wireguard", "vpn session", "create vpn"],
    priority: 74,
  },
  "vms.deleteVm": {
    productArea: "vms",
    aliases: ["delete vm", "remove vm", "destroy vm"],
    priority: 44,
  },
  "vms.execCommand": {
    productArea: "vms",
    aliases: ["exec", "run command", "vm exec", "execute command"],
    priority: 62,
  },
  "vms.lifecycle": {
    productArea: "vms",
    aliases: ["vm lifecycle", "running vm", "suspend vm", "stop vm", "fork vm"],
    priority: 58,
  },
  "vms.listVms": {
    productArea: "vms",
    aliases: ["list vms", "show vms", "vm list"],
    priority: 44,
  },
  "vms.resizeVm": {
    productArea: "vms",
    aliases: ["resize vm", "vm size", "custom vm size", "configure vm size", "cpu memory disk"],
    priority: 64,
  },
  "vms.routeWebTraffic": {
    productArea: "vms",
    aliases: ["route web traffic", "web traffic", "vm domain", "public https"],
    priority: 58,
  },
  "vms.sshAccess": {
    productArea: "vms",
    aliases: ["ssh", "ssh vm", "vm ssh", "ssh access", "connect ssh"],
    priority: 90,
  },
  "vms.workWithFiles": {
    productArea: "vms",
    aliases: ["vm files", "read vm file", "write vm file", "work with files"],
    priority: 54,
  },
} as const satisfies Record<DocsSearchIntentName, DocsSearchIntentDefinition>;

export function isDocsSearchIntentName(name: string): name is DocsSearchIntentName {
  return docsSearchIntentNames.includes(name as DocsSearchIntentName);
}

export function docsSearchIntentFor(name: DocsSearchIntentName) {
  return docsSearchIntents[name];
}
