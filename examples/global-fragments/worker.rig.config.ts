import { serviceWorkflow } from "./shared/service-workflow.ts";

export default serviceWorkflow({
  id: "worker",
  packageName: "@acme/worker",
  sourceDir: "services/worker",
  devCommand: "pnpm --filter @acme/worker dev",
});
