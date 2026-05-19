import { api } from "./workflows/api.ts";
import { docs } from "./workflows/docs.ts";
import { web } from "./workflows/web.ts";
import { worker } from "./workflows/worker.ts";

export const workflows = {
  api,
  web,
  worker,
  docs,
};
