import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initProject } from "./init.ts";

describe("initProject", () => {
  test("creates only the canonical Rigkit config folder", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "rigkit-init-"));
    const result = initProject({ projectDir });
    const configPath = join(projectDir, "rigkit", "index.ts");

    expect(result).toEqual({
      projectDir,
      configPath,
      created: {
        config: true,
      },
    });
    expect(existsSync(configPath)).toBe(true);
    expect(existsSync(join(projectDir, "package.json"))).toBe(false);
    expect(existsSync(join(projectDir, ".env"))).toBe(false);
    expect(existsSync(join(projectDir, ".env.example"))).toBe(false);
    expect(existsSync(join(projectDir, ".gitignore"))).toBe(false);

    const config = readFileSync(configPath, "utf8");
    expect(config).toContain('workflow("dev"');
    expect(config).toContain('cmux.provider()');
    expect(config).toContain('freestyle.terminal()');
    expect(config).toContain('gh auth login --hostname github.com');
    expect(config).toContain('gh repo clone ${shellQuote(repo)} ${shellQuote(repoPath)}');
    expect(config).toContain('.workspaceOperation("open-cmux"');
    expect(config).toContain('.workspaceOperation("open-vscode"');
    expect(config).toContain('.workspaceOperation("ssh"');
    expect(config).not.toContain("rig.config.ts");
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
