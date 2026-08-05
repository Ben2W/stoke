import { upgradeManagedRunSocket } from "../../../server/run-websocket.ts";

export const maxDuration = 300;

export async function GET(request: Request): Promise<Response> {
  return upgradeManagedRunSocket(request);
}
