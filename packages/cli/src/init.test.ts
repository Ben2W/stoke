import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initProject } from "./init.ts";
import { STOKE_CLI_VERSION } from "./version.ts";

describe("initProject", () => {
  test("creates the canonical Stoke config and package metadata", () => {
    const projectDir = join(mkdtempSync(join(tmpdir(), "rigkit-init-")), "My Project");
    const result = initProject({ projectDir });
    const configPath = join(projectDir, "rigkit", "index.ts");
    const packageJsonPath = join(projectDir, "package.json");

    expect(result).toEqual({
      name: "my-project",
      projectDir,
      configPath,
      packageJsonPath,
      created: {
        config: true,
        packageJson: true,
      },
      updated: {
        packageJson: false,
      },
    });
    expect(existsSync(configPath)).toBe(true);
    expect(existsSync(packageJsonPath)).toBe(true);
    expect(existsSync(join(projectDir, ".env"))).toBe(false);
    expect(existsSync(join(projectDir, ".env.example"))).toBe(false);
    expect(existsSync(join(projectDir, ".gitignore"))).toBe(false);

    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    expect(pkg).toMatchObject({
      name: "my-project",
      private: true,
      type: "module",
      scripts: {
        apply: "stoke apply",
        plan: "stoke plan",
      },
      devDependencies: {
        "@usestoke/provider-vercel-sandbox": STOKE_CLI_VERSION,
        "@usestoke/sdk": STOKE_CLI_VERSION,
      },
    });

    const config = readFileSync(configPath, "utf8");
    expect(config).toContain('workflow("dev"');
    expect(config).toContain('vercelSandbox.provider()');
    expect(config).toContain('vercelSandbox.terminal()');
    expect(config).toContain('.workspaceOperation("ssh"');
    expect(config).not.toContain("stoke.config.ts");
  });

  test("updates existing package metadata without replacing unrelated fields", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "rigkit-init-package-"));
    writeFileSync(join(projectDir, "package.json"), `${JSON.stringify({
      name: "custom-project",
      private: false,
      scripts: {
        test: "echo ok",
      },
      dependencies: {
        "@usestoke/sdk": "0.0.1",
      },
    }, null, 2)}\n`);

    const result = initProject({ projectDir });
    const pkg = JSON.parse(readFileSync(join(projectDir, "package.json"), "utf8"));

    expect(result.created.packageJson).toBe(false);
    expect(result.updated.packageJson).toBe(true);
    expect(pkg.name).toBe("custom-project");
    expect(pkg.private).toBe(true);
    expect(pkg.scripts).toEqual({
      apply: "stoke apply",
      plan: "stoke plan",
      test: "echo ok",
    });
    expect(pkg.dependencies["@usestoke/sdk"]).toBe(STOKE_CLI_VERSION);
    expect(pkg.devDependencies["@usestoke/provider-vercel-sandbox"]).toBe(STOKE_CLI_VERSION);
  });

  test("rejects an existing canonical config", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "rigkit-init-"));
    const configPath = join(projectDir, "rigkit", "index.ts");
    initProject({ projectDir });
    writeFileSync(configPath, "export const userEdit = true;\n");

    expect(() => initProject({ projectDir })).toThrow(`${configPath} already exists.`);
    expect(readFileSync(configPath, "utf8")).toBe("export const userEdit = true;\n");
  });
});
