import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initProject, normalizeMachineName } from "./init.ts";
import { FREESTYLE_PROVIDER_PACKAGE_NAME, PROJECT_PACKAGE_NAME } from "./project.ts";
import { RIGKIT_CLI_VERSION } from "./version.ts";

describe("initProject", () => {
  test("creates a full Rigkit project", () => {
    const parentDir = mkdtempSync(join(tmpdir(), "rigkit-init-"));
    const projectDir = join(parentDir, "platform-api");
    const result = initProject({
      projectDir,
      configPath: join(projectDir, "rig.config.ts"),
      name: "Platform API",
      apiKey: "fs_test_123",
    });

    expect(result.name).toBe("platform-api");
    expect(result.projectDir).toBe(projectDir);
    expect(existsSync(projectDir)).toBe(true);
    expect(result.created).toEqual({
      config: true,
      env: true,
      envExample: true,
      gitignore: true,
      packageJson: true,
    });

    expect(readFileSync(join(projectDir, "rig.config.ts"), "utf8")).toContain('sequence("platform-api"');
    expect(readFileSync(join(projectDir, "rig.config.ts"), "utf8")).toContain("defineConfig({");
    expect(readFileSync(join(projectDir, ".env"), "utf8")).toBe("FREESTYLE_API_KEY=fs_test_123\n");
    expect(readFileSync(join(projectDir, ".env.example"), "utf8")).toBe("FREESTYLE_API_KEY=\n");
    expect(readFileSync(join(projectDir, ".gitignore"), "utf8")).toContain(".env\n.rigkit/\n");

    const pkg = JSON.parse(readFileSync(join(projectDir, "package.json"), "utf8"));
    expect(pkg.name).toBe("platform-api");
    expect(pkg.scripts.plan).toBe("rig plan");
    expect(pkg.scripts.apply).toBe("rig apply");
    expect(pkg.devDependencies[PROJECT_PACKAGE_NAME]).toBe(RIGKIT_CLI_VERSION);
    expect(pkg.devDependencies[FREESTYLE_PROVIDER_PACKAGE_NAME]).toBe(RIGKIT_CLI_VERSION);
  });

  test("updates existing project files without replacing package metadata", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "rigkit-init-"));
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, ".env"), "OTHER=value\nFREESTYLE_API_KEY=old\n");
    writeFileSync(join(projectDir, ".gitignore"), "node_modules/\n");
    writeFileSync(
      join(projectDir, "package.json"),
      `${JSON.stringify({ name: "existing", scripts: { test: "bun test" } }, null, 2)}\n`,
    );

    const result = initProject({
      projectDir,
      configPath: join(projectDir, "rig.config.ts"),
      name: "dev",
      apiKey: "new-key",
    });

    expect(result.created.packageJson).toBe(false);
    expect(result.updated.packageJson).toBe(true);
    expect(readFileSync(join(projectDir, ".env"), "utf8")).toBe("OTHER=value\nFREESTYLE_API_KEY=new-key\n");
    expect(readFileSync(join(projectDir, ".gitignore"), "utf8")).toBe("node_modules/\n.env\n.rigkit/\n");

    const pkg = JSON.parse(readFileSync(join(projectDir, "package.json"), "utf8"));
    expect(pkg.name).toBe("existing");
    expect(pkg.scripts.test).toBe("bun test");
    expect(pkg.scripts.plan).toBe("rig plan");
  });
});

describe("normalizeMachineName", () => {
  test("normalizes human names into machine names", () => {
    expect(normalizeMachineName("  My Platform API  ")).toBe("my-platform-api");
  });

  test("rejects empty names", () => {
    expect(() => normalizeMachineName("   ")).toThrow("Project name is required.");
    expect(() => normalizeMachineName("!!!")).toThrow("Project name is required.");
  });
});
