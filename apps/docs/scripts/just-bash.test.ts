import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { beforeAll, describe, expect, test } from "vitest";

const root = process.cwd();
const justBashPath = path.join(root, "dist/docs/client/docs/just-bash");
const docsShPath = path.join(root, "dist/docs/client/docs/docs.sh");

function runChecked(command: string, args: string[]) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`);
  }
}

function justBash(input: string) {
  const result = spawnSync("bash", [justBashPath], {
    cwd: root,
    input,
    encoding: "utf8",
    env: { ...process.env, TERM: "dumb", PAGER: "cat" },
  });

  if (result.status !== 0) {
    throw new Error(`just-bash failed:\n${result.stdout}\n${result.stderr}`);
  }

  return result.stdout;
}

beforeAll(() => {
  if (!existsSync(justBashPath)) {
    runChecked("bun", ["run", "build"]);
  }
}, 30_000);

describe("just-bash docs VFS", () => {
  test("supports shell-style navigation and reading docs", () => {
    const output = justBash("pwd\nls /\nls /docs/guides\ncd docs/guides\npwd\ncat quickstart\ncat /docs/index.md\nexit\n");

    expect(output).toContain("docs.rigkit.dev:/$");
    expect(output).toContain("docs/");
    expect(output).toContain("monorepo/");
    expect(output).toContain("README.md");
    expect(output).toContain("quickstart.md");
    expect(output).toContain("docs.rigkit.dev:/docs/guides$");
    expect(output).toContain("This guide creates a minimal Rigkit project");
    expect(output).toContain("## AI-readable docs");
    expect(output).toContain("https://www.rigkit.dev/docs/bash");
  });

  test("supports direct command mode and search", () => {
    const result = spawnSync("bash", [justBashPath, "search", "workspace"], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, TERM: "dumb", PAGER: "cat" },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("/docs/guides/quickstart.md");
  });

  test("supports direct command mode for path resolution and tree output", () => {
    const cat = spawnSync("bash", [justBashPath, "cat", "/docs/guides/quickstart.md"], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, TERM: "dumb", PAGER: "cat" },
    });
    const tree = spawnSync("bash", [justBashPath, "tree"], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, TERM: "dumb", PAGER: "cat" },
    });

    expect(cat.status).toBe(0);
    expect(cat.stdout).toContain("This guide creates a minimal Rigkit project");
    expect(tree.status).toBe(0);
    expect(tree.stdout).toContain("docs/guides/quickstart.md");
    expect(tree.stdout).toContain("docs/providers/freestyle.md");
    expect(tree.stdout).toContain("monorepo/package.json");
  });

  test("mounts the Rigkit source tree in the virtual filesystem", () => {
    const packageJson = spawnSync("bash", [justBashPath, "cat", "/monorepo/package.json"], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, TERM: "dumb", PAGER: "cat" },
    });
    const grep = spawnSync(
      "bash",
      [justBashPath, "grep", "createDocsVirtualFiles", "/monorepo/apps/docs/src/lib/docs-vfs.ts"],
      {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, TERM: "dumb", PAGER: "cat" },
      },
    );
    const exampleTasks = spawnSync(
      "bash",
      [justBashPath, "ls", "/monorepo/examples/freestyle-website-next/rigkit/tasks"],
      {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, TERM: "dumb", PAGER: "cat" },
      },
    );

    expect(packageJson.status).toBe(0);
    expect(packageJson.stdout).toContain('"name": "rigkit-monorepo"');
    expect(grep.status).toBe(0);
    expect(grep.stdout).toContain("/monorepo/apps/docs/src/lib/docs-vfs.ts");
    expect(exampleTasks.status).toBe(0);
    expect(exampleTasks.stdout).toContain("execute-codex-task.ts");
  });

  test("docs.sh is a runnable alias for just-bash", () => {
    const result = spawnSync("bash", [docsShPath, "cat", "/docs/providers/freestyle.md"], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, TERM: "dumb", PAGER: "cat" },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("The Freestyle provider gives Rigkit configs");
  });
});
