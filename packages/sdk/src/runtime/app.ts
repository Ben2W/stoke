import { RIGKIT_ENGINE_VERSION } from "@usestoke/engine";
import { RIGKIT_RUNTIME_VERSION } from "./version.ts";
import { createRuntimeControlApiHandler } from "./api-handlers.ts";
import {
  RUNTIME_API_VERSION,
  RUNTIME_PROTOCOL_HASH,
} from "./protocol.ts";
import { type RunStore } from "./runs.ts";
import type { RuntimeContext } from "./types.ts";

export type { RuntimeAppState } from "./control.ts";

export type RuntimeApp = {
  fetch(request: Request): Promise<Response>;
  request(path: string, init?: RequestInit): Promise<Response>;
};

export function createRuntimeApp(context: RuntimeContext, store: RunStore): RuntimeApp {
  const controlApi = createRuntimeControlApiHandler(context, store);

  return {
    async fetch(request) {
      return controlApi.handler(request);
    },

    async request(path, init) {
      const url = path.startsWith("http://") || path.startsWith("https://")
        ? path
        : `http://runtime.local${path.startsWith("/") ? path : `/${path}`}`;
      return await this.fetch(new Request(url, init)) ?? runtimeJsonError(500, "Request did not produce a response");
    },
  };
}

export function sessionRunIdFor(pathname: string): string | undefined {
  const match = /^\/runs\/([^/]+)\/session$/.exec(pathname);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

export function runtimeJsonError(status: number, message: string): Response {
  return withRuntimeHeaders(Response.json({ error: { message } }, { status }));
}

export function withRuntimeHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(runtimeHeaders())) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function runtimeHeaders() {
  return {
    "x-rigkit-api-version": String(RUNTIME_API_VERSION),
    "x-rigkit-protocol-hash": RUNTIME_PROTOCOL_HASH,
    "x-rigkit-engine-version": RIGKIT_ENGINE_VERSION,
    "x-rigkit-runtime-version": RIGKIT_RUNTIME_VERSION,
  };
}
