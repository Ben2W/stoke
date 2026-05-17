// Captures `console.log` / `info` / `debug` / `warn` / `error` invoked inside a
// step handler and routes the output through that step's logger. This lets
// users write `console.log("foo")` instead of threading `step.log` through
// every helper, and surfaces third-party SDK output for free.
//
// Scoped via AsyncLocalStorage so:
//   - Engine/runtime code that itself uses `console.*` is never touched.
//   - Concurrent step executions each get their own logger.
//
// Disabled by `RIGKIT_NO_CONSOLE_INTERCEPT=1`.

import { AsyncLocalStorage } from "node:async_hooks";
import { formatWithOptions } from "node:util";

export type ConsoleLevel = "debug" | "info" | "log" | "warn" | "error";

export type StepConsoleSink = (input: { level: ConsoleLevel; message: string }) => void;

type ConsoleMethod = "debug" | "info" | "log" | "warn" | "error";

const METHODS: readonly ConsoleMethod[] = ["debug", "info", "log", "warn", "error"] as const;
const STORAGE = new AsyncLocalStorage<StepConsoleSink>();

let installed = false;
const originalMethods: Partial<Record<ConsoleMethod, (...args: unknown[]) => void>> = {};

export function runWithStepConsole<T>(sink: StepConsoleSink, fn: () => Promise<T> | T): Promise<T> | T {
  if (process.env.RIGKIT_NO_CONSOLE_INTERCEPT === "1") return fn();
  ensureInstalled();
  return STORAGE.run(sink, fn);
}

function ensureInstalled(): void {
  if (installed) return;
  installed = true;

  // util.formatWithOptions colors based on the second arg. We disable colors so
  // the captured output is plain (the CLI presenter colors it on the render
  // side based on level, which is the right place for terminal styling).
  const formatOptions = { colors: false, depth: 4, breakLength: 80 } as const;

  for (const method of METHODS) {
    const original = console[method].bind(console);
    originalMethods[method] = original;
    console[method] = (...args: unknown[]) => {
      const sink = STORAGE.getStore();
      if (!sink) {
        original(...args);
        return;
      }
      try {
        const message = formatWithOptions(formatOptions, ...args);
        sink({ level: methodToLevel(method), message });
      } catch {
        // If formatting fails, fall back to the original so users at least see
        // something instead of swallowing their log.
        original(...args);
      }
    };
  }
}

function methodToLevel(method: ConsoleMethod): ConsoleLevel {
  return method;
}

// Test-only: restore the original console methods. Not exported from the
// package's public surface but used by engine.test.ts.
export function __resetConsoleInterceptForTests(): void {
  for (const method of METHODS) {
    const original = originalMethods[method];
    if (original) console[method] = original;
  }
  installed = false;
}
