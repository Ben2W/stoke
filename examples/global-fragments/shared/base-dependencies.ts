import { sequence } from "@rigkit/sdk";

export const baseDependencies = sequence("base-dependencies")
  .configure({
    node: "22.11.0",
    packageManager: "pnpm@9.15.9",
    osImage: "ubuntu-24.04",
  })
  .task("resolve-toolchain", async ({ config, step }) => {
    const node = String(config.node);
    const packageManager = String(config.packageManager);
    const osImage = String(config.osImage);

    step.log(
      `resolved shared toolchain ${node} / ${packageManager} on ${osImage}`,
    );

    return {
      ctx: {
        toolchain: {
          node,
          packageManager,
          osImage,
        },
      },
    };
  })
  .task("warm-package-store", async ({ config, step }) => {
    const storeKey = [
      "package-store",
      String(config.osImage),
      String(config.node),
      String(config.packageManager),
    ].join(":");

    step.log(`warmed shared package store ${storeKey}`);

    return {
      ctx: {
        ...step.ctx,
        packageStoreKey: storeKey,
      },
    };
  });
