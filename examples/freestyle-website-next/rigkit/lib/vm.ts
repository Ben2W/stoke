import type { FreestyleSdkVm } from "@rigkit/provider-freestyle";
import { shellQuote } from "./shell";

type ExecInput = Parameters<FreestyleSdkVm["exec"]>[0];

export async function execOrThrow(
  vm: Pick<FreestyleSdkVm, "exec">,
  label: string,
  options: ExecInput,
): Promise<Awaited<ReturnType<FreestyleSdkVm["exec"]>>> {
  const result = await vm.exec(options);
  if ((result.statusCode ?? 0) !== 0) {
    throw new Error(
      `${label} failed:\n${result.stdout ?? ""}${result.stderr ?? ""}`.trim(),
    );
  }
  return result;
}

export async function waitForLocalhostHtml(
  vm: Pick<FreestyleSdkVm, "exec">,
  port: number,
): Promise<void> {
  const url = `http://127.0.0.1:${port}/`;
  await execOrThrow(vm, `Dev server did not return HTML on localhost:${port}`, {
    command: [
      "set -e",
      "tmp_dir=$(mktemp -d)",
      "trap 'rm -rf \"$tmp_dir\"' EXIT",
      "for attempt in $(seq 1 120); do",
      `  if curl -fsS --max-time 5 -o "$tmp_dir/body" ${shellQuote(url)} >/dev/null 2>&1; then`,
      `    if grep -Eiq '<!doctype html|<html[[:space:]>]' "$tmp_dir/body"; then`,
      "      exit 0",
      "    fi",
      "  fi",
      "  sleep 1",
      "done",
      `curl -i -sS --max-time 10 ${shellQuote(url)} | sed -n '1,80p' || true`,
      "exit 1",
    ].join("\n"),
    timeoutMs: 125 * 1000,
  });
}
