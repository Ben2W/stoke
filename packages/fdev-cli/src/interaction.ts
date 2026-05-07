import type { InteractionPresenter } from "@freestyle-sh/fdev-engine";

export function createLocalInteractionPresenter(): InteractionPresenter {
  return async (request) => {
    console.error(`\nInteractive task: ${request.title}`);
    if (request.instructions) console.error(request.instructions);
    console.error(`Open ${request.url}`);

    openUrl(request.url);
  };
}

function openUrl(url: string): void {
  if (process.env.FDEV_NO_BROWSER === "1") return;

  const command =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];

  try {
    const proc = Bun.spawn(command, {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });
    proc.exited.catch(() => {});
  } catch {
    // The engine also emits the URL, so failed auto-open still leaves a manual path.
  }
}
