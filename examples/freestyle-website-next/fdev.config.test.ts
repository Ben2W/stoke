import { describe, expect, test } from "bun:test";
import type { FreestyleWorkspaceContext } from "@freestyle-sh/fdev-provider-freestyle";

describe("freestyle website cmux ssh", () => {
  test("uses Freestyle token SSH without password auth or ControlMaster overrides", async () => {
    const originalApiKey = process.env.FREESTYLE_API_KEY;
    process.env.FREESTYLE_API_KEY = originalApiKey ?? "test-api-key";

    try {
      const { cmuxSshDestination, cmuxSshOptions } = await import("./fdev.config.ts");
      const context: FreestyleWorkspaceContext = {
        host: "vm-ssh.freestyle.sh",
        username: "website-user",
        vscodeAuthority: "ssh-remote+website-user",
        ssh: {
          kind: "ssh",
          host: "vm-ssh.freestyle.sh",
          port: 22,
          username: "website-user",
          auth: {
            type: "token",
            token: "token.with.dots",
          },
          command: "ssh website-user@vm-ssh.freestyle.sh",
        },
      };

      expect(cmuxSshDestination(context)).toBe(
        "website-user,token.with.dots@vm-ssh.freestyle.sh",
      );
      expect(cmuxSshOptions(context)).toEqual([
        "RequestTTY=force",
        "StrictHostKeyChecking=no",
        "UserKnownHostsFile=/dev/null",
        "LogLevel=ERROR",
        "IdentitiesOnly=yes",
        "IdentityFile=/dev/null",
      ]);
      expect(cmuxSshOptions(context)).not.toContain("PreferredAuthentications=none,password");
      expect(cmuxSshOptions(context)).not.toContain("ControlMaster=no");
    } finally {
      restoreEnv("FREESTYLE_API_KEY", originalApiKey);
    }
  });
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
