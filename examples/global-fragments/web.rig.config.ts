import { serviceWorkflow } from "./shared/service-workflow.ts";

export default serviceWorkflow({
  id: "web",
  packageName: "@acme/web",
  sourceDir: "apps/web",
  devCommand: "pnpm --filter @acme/web dev",
});
