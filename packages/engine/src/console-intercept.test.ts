import { afterEach, describe, expect, test } from "bun:test";
import {
  __resetConsoleInterceptForTests,
  runWithStepConsole,
  type ConsoleLevel,
  type StepConsoleSink,
} from "./console-intercept.ts";

type Captured = { level: ConsoleLevel; message: string };

function collector(): { sink: StepConsoleSink; entries: Captured[] } {
  const entries: Captured[] = [];
  return { sink: (input) => entries.push(input), entries };
}

afterEach(() => {
  __resetConsoleInterceptForTests();
  delete process.env.RIGKIT_NO_CONSOLE_INTERCEPT;
});

describe("runWithStepConsole", () => {
  test("captures console.{log,info,debug,warn,error} with the right level", async () => {
    const { sink, entries } = collector();
    await runWithStepConsole(sink, async () => {
      console.log("a log line");
      console.info("an info line");
      console.debug("a debug line");
      console.warn("a warn line");
      console.error("an error line");
    });

    expect(entries).toEqual([
      { level: "log", message: "a log line" },
      { level: "info", message: "an info line" },
      { level: "debug", message: "a debug line" },
      { level: "warn", message: "a warn line" },
      { level: "error", message: "an error line" },
    ]);
  });

  test("formats objects and printf args like the real console", async () => {
    const { sink, entries } = collector();
    await runWithStepConsole(sink, async () => {
      console.log("counts:", { a: 1, b: 2 });
      console.log("user %s scored %d", "alice", 42);
    });

    expect(entries[0]!.message).toBe("counts: { a: 1, b: 2 }");
    expect(entries[1]!.message).toBe("user alice scored 42");
  });

  test("preserves the scope across async boundaries", async () => {
    const { sink, entries } = collector();
    const inner = async () => {
      await Promise.resolve();
      console.log("inside async helper");
    };
    await runWithStepConsole(sink, async () => {
      await inner();
    });

    expect(entries).toEqual([{ level: "log", message: "inside async helper" }]);
  });

  test("isolates concurrent step contexts", async () => {
    const a = collector();
    const b = collector();
    await Promise.all([
      runWithStepConsole(a.sink, async () => {
        await Promise.resolve();
        console.log("from A");
      }),
      runWithStepConsole(b.sink, async () => {
        await Promise.resolve();
        console.warn("from B");
      }),
    ]);

    expect(a.entries).toEqual([{ level: "log", message: "from A" }]);
    expect(b.entries).toEqual([{ level: "warn", message: "from B" }]);
  });

  test("RIGKIT_NO_CONSOLE_INTERCEPT=1 disables capture", async () => {
    process.env.RIGKIT_NO_CONSOLE_INTERCEPT = "1";
    const { sink, entries } = collector();
    const consoleLogSpy: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => consoleLogSpy.push(String(args[0] ?? ""));
    try {
      await runWithStepConsole(sink, async () => {
        console.log("should fall through to original");
      });
    } finally {
      console.log = originalLog;
    }

    expect(entries).toEqual([]);
    expect(consoleLogSpy).toEqual(["should fall through to original"]);
  });

  test("outside the scope, console.* falls through to its original implementation", async () => {
    const { sink, entries } = collector();
    // Install the patch by running a scoped call once.
    await runWithStepConsole(sink, async () => {
      console.log("inside");
    });

    // Now call outside — should not show up in entries.
    const originalLog = console.log;
    const outsideCalls: unknown[][] = [];
    console.log = (...args: unknown[]) => outsideCalls.push(args);
    try {
      console.log("outside");
    } finally {
      console.log = originalLog;
    }

    expect(entries).toEqual([{ level: "log", message: "inside" }]);
    expect(outsideCalls).toEqual([["outside"]]);
  });
});
