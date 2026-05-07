import { describe, expect, test } from "bun:test";
import {
  gcloudAccessTokenFreshCommand,
  gcloudAccessTokenInjection,
  gcloudConfigCopyInjection,
  gcloudConfigCopyInjectionSteps,
  gcloudCopiedConfigReadyCommand,
} from "./inject.ts";

describe("gcloud config copy helpers", () => {
  test("keeps token material in env instead of the emitted command", () => {
    const injection = gcloudAccessTokenInjection({
      accessToken: "secret-token",
      tokenType: "Bearer",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      account: "dev@example.com",
      scopes: ["openid"],
    });

    expect(injection.command).not.toContain("secret-token");
    expect(injection.env.FDEV_GCLOUD_ACCESS_TOKEN).toBe("secret-token");
    expect(injection.env.FDEV_GCLOUD_ACCOUNT).toBe("dev@example.com");
    expect(injection.command).toContain("gcloud config set auth/access_token_file");
    expect(injection.command).toContain("gcloud config set account");
  });

  test("supports hour-style freshness checks", () => {
    const command = gcloudAccessTokenFreshCommand({ minExpiration: "6hrs" });
    expect(command).toContain("21600000");
  });

  test("copies gcloud config files without embedding file contents in the command", () => {
    const injection = gcloudConfigCopyInjection({
      sourceConfigDir: "/Users/dev/.config/gcloud",
      account: "dev@example.com",
      files: [
        { path: "active_config", contentsBase64: Buffer.from("default").toString("base64") },
        { path: "credentials.db", contentsBase64: "secret-db-base64" },
      ],
    });

    expect(injection.command).toContain("rm -rf \"$config_dir\"");
    expect(injection.command).toContain("gcloud CLI is not installed");
    expect(injection.command).toContain("credentials.db");
    expect(injection.command).toContain("gcloud config set account");
    expect(injection.command).not.toContain("secret-db-base64");
    expect(injection.env.FDEV_GCLOUD_CONFIG_FILE_1).toBe("secret-db-base64");
    expect(injection.env.FDEV_GCLOUD_ACCOUNT).toBe("dev@example.com");
    expect(gcloudCopiedConfigReadyCommand()).toContain("gcloud auth list");
  });

  test("splits copied gcloud config files into small upload steps", () => {
    const steps = gcloudConfigCopyInjectionSteps(
      {
        sourceConfigDir: "/Users/dev/.config/gcloud",
        files: [
          { path: "credentials.db", contentsBase64: "1234567890abcdef" },
        ],
      },
      { chunkSize: 8 },
    );

    expect(steps).toHaveLength(3);
    expect(steps[0]!.name).toBe("prepare gcloud config copy");
    expect(steps[1]!.env.FDEV_GCLOUD_CONFIG_FILE_CHUNK).toBe("12345678");
    expect(steps[2]!.env.FDEV_GCLOUD_CONFIG_FILE_CHUNK).toBe("90abcdef");
    expect(steps[1]!.command).toContain(": > \"$config_dir/credentials.db\"");
    expect(steps[2]!.command).not.toContain(": > \"$config_dir/credentials.db\"");
  });
});
