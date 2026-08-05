import { describe, expect, test } from "bun:test";
import { createRunPresenter } from "./run-presenter.ts";
import { sym } from "./ui.ts";

describe("createRunPresenter", () => {
  test("keeps replayable fetch error blocks copyable", () => {
    const longValue = "a".repeat(80);
    const output = captureStderr(() => {
      const presenter = createRunPresenter("apply");
      expect(presenter).toBeDefined();
      presenter!.render({
        type: "log.output",
        stream: "error",
        data: [
          "Vercel API request failed. Replay request:",
          'await fetch("https://api.vercel.sh/v1/vms", {',
          '  method: "POST",',
          `  headers: { "x-long": "${longValue}" },`,
          "});",
          "Response: 500 Internal Server Error",
        ].join("\n"),
      });
      presenter!.close();
    }, { columns: 24 });

    const plain = stripAnsi(output);
    expect(plain).toContain(`    ${sym.err} Vercel API request failed. Replay request:\n      await fetch`);
    expect(plain).not.toContain(`${sym.err} await fetch`);
    expect(plain).not.toContain(`${sym.err}   method`);
    expect(plain).toContain(longValue);
    expect(plain).not.toContain(sym.ellipsis);
  });
});

function captureStderr(fn: () => void, options: { columns?: number } = {}): string {
  const chunks: string[] = [];
  const previousWrite = process.stderr.write;
  const previousColumns = process.stderr.columns;
  const previousRender = process.env.STOKE_RENDER;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    chunks.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  if (options.columns !== undefined) {
    process.stderr.columns = options.columns;
  }
  delete process.env.STOKE_RENDER;
  try {
    fn();
  } finally {
    process.stderr.write = previousWrite;
    process.stderr.columns = previousColumns;
    if (previousRender === undefined) {
      delete process.env.STOKE_RENDER;
    } else {
      process.env.STOKE_RENDER = previousRender;
    }
  }
  return chunks.join("");
}

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
}
