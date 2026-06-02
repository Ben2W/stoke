import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, rmSync } from "node:fs";
import net from "node:net";
import path from "node:path";

const host = process.env.DOCS_DEV_HOST ?? "127.0.0.1";
const requestedAstroPort = process.env.DOCS_ASTRO_PORT
  ? Number(process.env.DOCS_ASTRO_PORT)
  : undefined;
const workerPort = Number(process.env.DOCS_WORKER_PORT ?? "8788");
const root = process.cwd();

function assertValidPort(port: number, name: string) {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`${name} must be a TCP port, received ${String(port)}`);
  }
}

function canListen(port: number) {
  return new Promise<boolean>((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

async function findAvailablePort(start: number) {
  for (let port = start; port < start + 30; port += 1) {
    if (await canListen(port)) return port;
  }

  throw new Error(`No available Astro dev port found starting at ${start}`);
}

async function resolveAstroPort() {
  if (requestedAstroPort !== undefined) {
    assertValidPort(requestedAstroPort, "DOCS_ASTRO_PORT");
    if (!(await canListen(requestedAstroPort))) {
      throw new Error(`DOCS_ASTRO_PORT ${requestedAstroPort} is already in use`);
    }
    return requestedAstroPort;
  }

  return findAvailablePort(4321);
}

async function assertWorkerPort() {
  assertValidPort(workerPort, "DOCS_WORKER_PORT");
  if (!(await canListen(workerPort))) {
    throw new Error(`DOCS_WORKER_PORT ${workerPort} is already in use`);
  }
}

function ensureWranglerAssetsDirectory() {
  mkdirSync(path.join(root, "dist/docs/client"), { recursive: true });
  rmSync(path.join(root, "dist/docs/client/docs/wrangler.json"), { force: true });
}

function spawnProcess(label: string, command: string, args: string[], env = process.env) {
  const child = spawn(command, args, {
    cwd: root,
    env: { ...env, NO_COLOR: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout?.on("data", (chunk) => process.stdout.write(`[${label}] ${chunk}`));
  child.stderr?.on("data", (chunk) => process.stderr.write(`[${label}] ${chunk}`));

  return child;
}

async function waitForHttp(url: string, child: ChildProcess, label: string) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`${label} exited before ${url} became ready`);
    }

    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.status < 500) return;
    } catch {
      // Server is still starting.
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timed out waiting for ${url}`);
}

function stop(child?: ChildProcess) {
  if (child && child.exitCode === null && !child.killed) child.kill();
}

async function main() {
  const astroPort = await resolveAstroPort();
  await assertWorkerPort();
  ensureWranglerAssetsDirectory();

  const astroOrigin = `http://${host}:${astroPort}`;
  const workerOrigin = `http://${host}:${workerPort}`;
  let astro: ChildProcess | undefined;
  let wrangler: ChildProcess | undefined;

  const shutdown = () => {
    stop(wrangler);
    stop(astro);
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  astro = spawnProcess(
    "astro",
    "bunx",
    [
      "astro",
      "dev",
      "--host",
      host,
      "--port",
      String(astroPort),
    ],
    {
      ...process.env,
      DOCS_ASTRO_HMR_HOST: host,
      DOCS_ASTRO_HMR_CLIENT_PORT: String(astroPort),
    },
  );
  await waitForHttp(`${astroOrigin}/docs/api/search-index.json`, astro, "Astro dev");

  wrangler = spawnProcess("worker", "bunx", [
    "wrangler",
    "dev",
    "--config",
    "wrangler.jsonc",
    "--local",
    "--host",
    host,
    "--port",
    String(workerPort),
    "--var",
    `DEV_ASSET_ORIGIN:${astroOrigin}`,
    "--var",
    `DEV_WORKER_ORIGIN:${workerOrigin}`,
    "--show-interactive-dev-session=false",
  ]);
  await waitForHttp(`${workerOrigin}/docs`, wrangler, "Wrangler dev");

  console.log(`\nDocs dev server: ${workerOrigin}/docs`);
  console.log(`Astro asset origin: ${astroOrigin}\n`);

  const [code, signal] = (await Promise.race([
    once(astro, "exit"),
    once(wrangler, "exit"),
  ])) as [number | null, NodeJS.Signals | null];

  shutdown();
  process.exitCode = code ?? (signal ? 1 : 0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
