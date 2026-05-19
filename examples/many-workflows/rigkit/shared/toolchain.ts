import { sequence } from "@rigkit/sdk";

export const baseToolchain = sequence("base-toolchain")
  .configure({
    nodeVersion: "22",
    packageManager: "pnpm@9.15.9",
    repoRoot: "/workspace/acme",
  })
  .task("resolve-toolchain", async ({ config }) => {
    const nodeVersion = String(config.nodeVersion);
    const packageManager = String(config.packageManager);
    const repoRoot = String(config.repoRoot);

    return {
      ctx: {
        toolchain: {
          nodeVersion,
          packageManager,
          repoRoot,
        },
      },
    };
  })
  .task("install-root-dependencies", async ({ step }) => {
    const packageStoreKey = [
      step.ctx.toolchain.packageManager,
      step.ctx.toolchain.nodeVersion,
      "acme-lockfile-v1",
    ].join(":");

    return {
      ctx: {
        ...step.ctx,
        packageStore: {
          key: packageStoreKey,
          path: `${step.ctx.toolchain.repoRoot}/.pnpm-store`,
        },
      },
    };
  });
