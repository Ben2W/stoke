import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStateStore } from "@rigkit/engine";
import { createGcloudConfigCopyController, assertLocalGcloudReady, type GcloudCommandRunner } from "./provider.ts";
import { createGcloudAuthStore } from "./store.ts";

describe("local gcloud config copy provider", () => {
  test("fails startup when local gcloud is missing", async () => {
    const runner: GcloudCommandRunner = async () => ({
      stdout: "",
      stderr: "command not found: gcloud",
      exitCode: 127,
    });

    await expect(assertLocalGcloudReady({}, runner)).rejects.toThrow("Local gcloud CLI is required");
  });

  test("fails startup when local gcloud is not authenticated", async () => {
    const runner: GcloudCommandRunner = async (_command, args) => {
      if (args[0] === "--version") return { stdout: "Google Cloud SDK", stderr: "", exitCode: 0 };
      return { stdout: "", stderr: "You do not currently have an active account selected.", exitCode: 1 };
    };

    await expect(assertLocalGcloudReady({}, runner)).rejects.toThrow("not authenticated");
  });

  test("mints and stores a fresh local gcloud access token", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "rigkit-gcloud-"));
    const state = createStateStore({ projectDir });
    await state.syncSchema();
    const store = createGcloudAuthStore(state.providerStorage("gcloud.config.copy"));
    const calls: string[][] = [];
    const runner: GcloudCommandRunner = async (_command, args) => {
      calls.push([...args]);
      if (args[0] === "auth") return { stdout: "access-token\n", stderr: "", exitCode: 0 };
      if (args[0] === "config") return { stdout: "dev@example.com\n", stderr: "", exitCode: 0 };
      throw new Error(`unexpected command ${args.join(" ")}`);
    };

    const controller = createGcloudConfigCopyController({}, store, runner);
    const runtime = await controller.runtime({} as never);
    const credentials = await runtime.freshAccessToken();

    expect(credentials.accessToken).toBe("access-token");
    expect(credentials.account).toBe("dev@example.com");
    expect(credentials.tokenType).toBe("Bearer");
    expect(Date.parse(credentials.expiresAt)).toBeGreaterThan(Date.now());
    expect(store.getCredentials()?.accessToken).toBe("access-token");
    expect(calls).toEqual([
      ["auth", "print-access-token", "--quiet"],
      ["config", "get-value", "account", "--quiet"],
    ]);
  });

  test("copies local gcloud config files needed for auth", async () => {
    const projectDir = mkdtempSync(join(tmpdir(), "rigkit-gcloud-"));
    const configDir = join(projectDir, "gcloud");
    mkdirSync(join(configDir, "configurations"), { recursive: true });
    mkdirSync(join(configDir, "logs"), { recursive: true });
    mkdirSync(join(configDir, "virtenv", "bin"), { recursive: true });
    writeFileSync(join(configDir, "active_config"), "default\n");
    writeFileSync(join(configDir, "access_tokens.db"), "access");
    writeFileSync(join(configDir, "credentials.db"), "credentials");
    writeFileSync(join(configDir, "default_configs.db"), "not copied config");
    writeFileSync(join(configDir, "configurations", "config_default"), "[core]\naccount = dev@example.com\n");
    writeFileSync(join(configDir, "logs", "ignored.log"), "noise");
    writeFileSync(join(configDir, "virtenv", "bin", "python"), "not copied config");

    const state = createStateStore({ projectDir });
    await state.syncSchema();
    const store = createGcloudAuthStore(state.providerStorage("gcloud.config.copy"));
    const calls: string[][] = [];
    const runner: GcloudCommandRunner = async (_command, args) => {
      calls.push([...args]);
      if (args[0] === "config") return { stdout: "dev@example.com\n", stderr: "", exitCode: 0 };
      if (args[0] === "info") return { stdout: `${configDir}\n`, stderr: "", exitCode: 0 };
      throw new Error(`unexpected command ${args.join(" ")}`);
    };

    const controller = createGcloudConfigCopyController({}, store, runner);
    const runtime = await controller.runtime({} as never);
    const configCopy = await runtime.configFiles();

    expect(configCopy.account).toBe("dev@example.com");
    expect(configCopy.sourceConfigDir).toBe(configDir);
    expect(configCopy.files.map((file) => file.path)).toEqual([
      "access_tokens.db",
      "active_config",
      "configurations/config_default",
      "credentials.db",
    ]);
    expect(Buffer.from(configCopy.files[3]!.contentsBase64, "base64").toString()).toBe("credentials");
    expect(calls).toEqual([
      ["config", "get-value", "account", "--quiet"],
      ["info", "--format=value(config.paths.global_config_dir)", "--quiet"],
    ]);
  });
});
