import { serviceWorkflow } from "../shared/service-workflow.ts";

export const web = serviceWorkflow({
  id: "web",
  packageName: "@acme/web",
  sourceDir: "apps/web",
  devCommand: "pnpm --filter @acme/web dev",
});
