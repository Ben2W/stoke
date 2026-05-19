import { services } from "../shared/catalog.ts";
import { serviceWorkflow } from "../shared/service-workflow.ts";

export const worker = serviceWorkflow(services.worker);
