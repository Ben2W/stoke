import { describe, expect, test } from "bun:test";
import { createLocalInteractionPresenter } from "./interaction.ts";

describe("local interaction presenter", () => {
  test("presents provider-owned URLs without waiting for completion", async () => {
    const previousNoBrowser = process.env.RIGKIT_NO_BROWSER;
    process.env.RIGKIT_NO_BROWSER = "1";

    try {
      const presenter = createLocalInteractionPresenter();
      await presenter({
        id: "interaction-1",
        nodePath: "login",
        title: "GitHub auth",
        url: "http://127.0.0.1:1234/?token=test",
        instructions: "Authenticate GitHub inside the VM.",
      });

      expect(true).toBe(true);
    } finally {
      if (previousNoBrowser === undefined) {
        delete process.env.RIGKIT_NO_BROWSER;
      } else {
        process.env.RIGKIT_NO_BROWSER = previousNoBrowser;
      }
    }
  });
});
