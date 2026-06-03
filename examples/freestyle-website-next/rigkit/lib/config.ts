export const repo = "freestyle-sh/freestyle-website-next";
export const repoUrl = `https://github.com/${repo}.git`;
export const repoPath = "/workspace/freestyle-website-next";

export const devPort = 4321;
export const devSessionName = "website-dev";
export const vmIdleTimeoutSeconds = 43200;
export const vmHome = "/root";
export const shpoolVersion = "0.10.0";

export const devEnvironmentPath =
  "/usr/local/bin:/root/.local/bin:/opt/bun/bin:/root/.cargo/bin:/usr/bin:/bin:/usr/sbin:/sbin";
export const devCommand = `/usr/local/bin/bun run dev -- --host 0.0.0.0 --port ${devPort}`;
export const shpoolSocketPath = `${vmHome}/.local/run/shpool/${devSessionName}.socket`;
