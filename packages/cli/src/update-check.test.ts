import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { maybePrintUpdateNotice } from "./update-check.ts";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("update check", () => {
  test("revalidates cached no-update metadata after the short interval", async () => {
    const rigkitHome = mkdtempSync(join(tmpdir(), "rigkit-update-check-"));
    let requests = 0;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        requests += 1;
        return Response.json({
          version: "0.2.12",
          installerUrl: "https://www.rigkit.dev/install",
        });
      },
    });
    const updateUrl = `http://127.0.0.1:${server.port}/latest.json`;
    mkdirSync(rigkitHome, { recursive: true });
    writeFileSync(join(rigkitHome, "update-check.json"), `${JSON.stringify({
      checkedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      updateUrl,
      latest: {
        version: "0.2.11",
        installerUrl: "https://www.rigkit.dev/install",
      },
    })}\n`);

    try {
      process.env.RIGKIT_HOME = rigkitHome;
      process.env.RIGKIT_UPDATE_URL = updateUrl;
      process.env.RIGKIT_UPDATE_TIMEOUT_MS = "2000";

      let output = "";
      await maybePrintUpdateNotice({
        currentVersion: "0.2.11",
        json: false,
        stream: {
          isTTY: true,
          write: (chunk) => {
            output += chunk;
          },
        },
      });

      expect(requests).toBe(1);
      expect(output).toContain("rig 0.2.12 is available");
    } finally {
      server.stop(true);
      rmSync(rigkitHome, { recursive: true, force: true });
    }
  });

  test("force mode ignores fresh cached metadata", async () => {
    const rigkitHome = mkdtempSync(join(tmpdir(), "rigkit-update-check-force-"));
    let requests = 0;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        requests += 1;
        return Response.json({
          version: "0.2.12",
          installerUrl: "https://www.rigkit.dev/install",
        });
      },
    });
    const updateUrl = `http://127.0.0.1:${server.port}/latest.json`;
    mkdirSync(rigkitHome, { recursive: true });
    writeFileSync(join(rigkitHome, "update-check.json"), `${JSON.stringify({
      checkedAt: new Date().toISOString(),
      updateUrl,
      latest: {
        version: "0.2.11",
        installerUrl: "https://www.rigkit.dev/install",
      },
    })}\n`);

    try {
      process.env.RIGKIT_HOME = rigkitHome;
      process.env.RIGKIT_UPDATE_CHECK = "force";
      process.env.RIGKIT_UPDATE_URL = updateUrl;
      process.env.RIGKIT_UPDATE_TIMEOUT_MS = "2000";

      let output = "";
      await maybePrintUpdateNotice({
        currentVersion: "0.2.11",
        json: false,
        stream: {
          write: (chunk) => {
            output += chunk;
          },
        },
      });

      expect(requests).toBe(1);
      expect(output).toContain("rig 0.2.12 is available");
    } finally {
      server.stop(true);
      rmSync(rigkitHome, { recursive: true, force: true });
    }
  });
});
