import { upgradeRunNotificationSocket } from "../../../server/run-notifications.ts";

export const maxDuration = 300;

export async function GET(request: Request): Promise<Response> {
  return await upgradeRunNotificationSocket(request);
}
