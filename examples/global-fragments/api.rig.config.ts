import { serviceWorkflow } from "./shared/service-workflow.ts";

export default serviceWorkflow({
  id: "api",
  packageName: "@acme/api",
  sourceDir: "services/api",
  devCommand: "pnpm --filter @acme/api dev",
});
