import { afterEach, describe, expect, test } from "bun:test";
import { Freestyle } from "freestyle";
import type { ProviderRuntimeContext } from "@rigkit/engine";
import { freestyleIdentityId, freestyleToken } from "./auth.ts";
import { createFreestyleWorkflowController } from "./provider.ts";

const previousFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = previousFetch;
});

describe("Freestyle provider host adapters", () => {
  test("creates SSH options and grants VM access internally", async () => {
    const requests: string[] = [];
    globalThis.fetch = (async (resource, init) => {
      requests.push(`${init?.method ?? "GET"} ${String(resource)}`);
      return Response.json({});
    }) as typeof fetch;

    const runtime = await createFreestyleWorkflowController({
      client: new Freestyle({ apiKey: "test-key" }),
      identityId: freestyleIdentityId("identity-stream"),
      token: freestyleToken("token"),
    }).runtime(providerContext());

    await expect(runtime.createSSHOptions({ vmId: "vm-stream" })).resolves.toEqual({
      kind: "ssh",
      host: "vm-ssh.freestyle.sh",
      username: "vm-stream",
      auth: { type: "token", token: "token" },
      command: "ssh vm-stream:token@vm-ssh.freestyle.sh",
    });
    expect(requests).toContain("POST https://api.freestyle.sh/identity/v1/identities/identity-stream/permissions/vm/vm-stream");
  });

  test("creates cmux ssh options with Freestyle-owned ssh settings", async () => {
    globalThis.fetch = (async () => Response.json({})) as unknown as typeof fetch;

    const runtime = await createFreestyleWorkflowController({
      client: new Freestyle({ apiKey: "test-key" }),
      identityId: freestyleIdentityId("identity-stream"),
      token: freestyleToken("token"),
    }).runtime(providerContext());

    const ssh = await runtime.cmux.createSshOptions({
      vmId: "vm-stream",
      sshOptions: ["ServerAliveInterval=15"],
      skipDaemonBootstrap: true,
    });

    expect(ssh).toEqual({
      kind: "ssh",
      destination: "vm-stream,token@vm-ssh.freestyle.sh",
      skipDaemonBootstrap: true,
      sshOptions: [
        "StrictHostKeyChecking=no",
        "UserKnownHostsFile=/dev/null",
        "LogLevel=ERROR",
        "IdentitiesOnly=yes",
        "IdentityFile=/dev/null",
        "ControlMaster=no",
        "ServerAliveInterval=15",
      ],
    });
  });

  test("creates VS Code URLs using the Freestyle ssh authority", async () => {
    globalThis.fetch = (async () => Response.json({})) as unknown as typeof fetch;

    const runtime = await createFreestyleWorkflowController({
      client: new Freestyle({ apiKey: "test-key" }),
      identityId: freestyleIdentityId("identity-stream"),
      token: freestyleToken("token"),
    }).runtime(providerContext());

    const url = await runtime.vscode.createUrl({ vmId: "vm-stream", cwd: "/workspace/site" });

    expect(url).toBe(
      "vscode://vscode-remote/ssh-remote+vm-stream%3Atoken%40vm-ssh.freestyle.sh/workspace/site?windowId=_blank",
    );
  });
});

function providerContext(): ProviderRuntimeContext {
  return {
    workflow: "workflow",
    nodePath: "workflow.step",
    emit: () => {},
    interaction: {
      present: async () => {
        throw new Error("unexpected interaction");
      },
    },
    local: {
      open: async () => {},
    },
    metadata: () => {},
  };
}
