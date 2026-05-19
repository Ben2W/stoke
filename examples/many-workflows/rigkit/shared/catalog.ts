export type ServiceDefinition = {
  id: string;
  packageName: string;
  sourceDir: string;
  buildCommand: string;
  devCommand: string;
  testCommand: string;
  runtime: "node" | "browser" | "worker" | "static";
  ports: number[];
  dependsOn: string[];
};

export const services = {
  api: {
    id: "api",
    packageName: "@acme/api",
    sourceDir: "services/api",
    buildCommand: "pnpm --filter @acme/api build",
    devCommand: "pnpm --filter @acme/api dev",
    testCommand: "pnpm --filter @acme/api test",
    runtime: "node",
    ports: [3000],
    dependsOn: ["postgres", "redis"],
  },
  web: {
    id: "web",
    packageName: "@acme/web",
    sourceDir: "apps/web",
    buildCommand: "pnpm --filter @acme/web build",
    devCommand: "pnpm --filter @acme/web dev --host 0.0.0.0",
    testCommand: "pnpm --filter @acme/web test",
    runtime: "browser",
    ports: [5173],
    dependsOn: ["api"],
  },
  worker: {
    id: "worker",
    packageName: "@acme/worker",
    sourceDir: "services/worker",
    buildCommand: "pnpm --filter @acme/worker build",
    devCommand: "pnpm --filter @acme/worker dev",
    testCommand: "pnpm --filter @acme/worker test",
    runtime: "worker",
    ports: [],
    dependsOn: ["postgres", "queue"],
  },
  docs: {
    id: "docs",
    packageName: "@acme/docs",
    sourceDir: "apps/docs",
    buildCommand: "pnpm --filter @acme/docs build",
    devCommand: "pnpm --filter @acme/docs dev --host 0.0.0.0",
    testCommand: "pnpm --filter @acme/docs check",
    runtime: "static",
    ports: [4321],
    dependsOn: ["web"],
  },
} satisfies Record<string, ServiceDefinition>;
