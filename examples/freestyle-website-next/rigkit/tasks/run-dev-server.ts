import { startDevServerSessionCommand } from "../lib/commands";
import { vmIdleTimeoutSeconds } from "../lib/config";
import type { WebsiteContext } from "../lib/types";
import { execOrThrow, waitForLocalhostHtml } from "../lib/vm";
import type { SetupTaskHandler } from "./types";

export const runDevServerTask: SetupTaskHandler<
  WebsiteContext,
  WebsiteContext
> = async ({ step, providers }) => {
  const created = await providers.freestyle.client.vms.create({
    snapshotId: step.ctx.snapshotId,
    idleTimeoutSeconds: vmIdleTimeoutSeconds,
    logger: console.log,
  });
  const { vmId } = created;
  const { vm } = created;

  try {
    console.log("starting website dev server in shpool");
    await execOrThrow(vm, "website dev server session", {
      command: startDevServerSessionCommand({
        repoPath: step.ctx.repoPath,
        command: step.ctx.devCommand,
        sessionName: step.ctx.devSessionName,
      }),
      timeoutMs: 60 * 1000,
    });

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
};
