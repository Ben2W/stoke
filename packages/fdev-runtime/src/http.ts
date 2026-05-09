import { HTTPException } from "hono/http-exception";

export function unauthorized(message = "Unauthorized"): never {
  throw new HTTPException(401, { message });
}

export function badRequest(message: string): never {
  throw new HTTPException(400, { message });
}

export function notFound(message: string): never {
  throw new HTTPException(404, { message });
}

export function serverError(message: string): never {
  throw new HTTPException(500, { message });
}

export function errorBody(error: unknown): { error: { message: string } } {
  return {
    error: {
      message: error instanceof Error ? error.message : String(error),
    },
  };
}

export async function parseJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    badRequest("Invalid JSON request body");
  }
}
