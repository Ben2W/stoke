import { Effect } from "effect";
import {
  RuntimeSessionError,
  type RuntimeClientError,
} from "./errors.ts";
import { toRuntimeTransportError } from "./http.ts";

export type RuntimeSessionHandlers = {
  hello?: RuntimeSessionHello;
  onOpen?(session: RuntimeSessionConnection): Promise<void> | void;
  onMessage(message: unknown, session: RuntimeSessionConnection): Promise<void> | void;
  onClose?(): Promise<void> | void;
};

export type RuntimeSessionHello = {
  type: "hello";
  transportVersion: number;
  host: {
    name: string;
    version: string;
  };
  hostMethods: Array<{ id: string; modes?: string[] }>;
  hostCapabilities: Array<{ id: string; schemaHash?: string }>;
};

export type RuntimeSessionConnection = {
  send(message: unknown): void;
  close(code?: number, reason?: string): void;
};

export function runtimeSessionEffect(
  baseUrl: string,
  token: string,
  path: string,
  handlers: RuntimeSessionHandlers,
): Effect.Effect<void, RuntimeClientError> {
  return Effect.tryPromise({
    try: () => connectSession(baseUrl, token, path, handlers),
    catch: (cause) => toRuntimeTransportError(cause, { method: "WS", path }),
  });
}

function connectSession(
  baseUrl: string,
  token: string,
  path: string,
  handlers: RuntimeSessionHandlers,
): Promise<void> {
  const url = new URL(path, baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";

  return createRuntimeWebSocket(url, token).then((ws) => new Promise((resolvePromise, rejectPromise) => {
    let settled = false;

    const connection: RuntimeSessionConnection = {
      send(message) {
        ws.send(JSON.stringify(message));
      },
      close(code, reason) {
        ws.close(code, reason);
      },
    };

    const settle = (error?: unknown) => {
      if (settled) return;
      settled = true;
      if (error) rejectPromise(error);
      else resolvePromise();
    };

    ws.addEventListener("open", async () => {
      try {
        connection.send(handlers.hello ?? defaultHello());
        await handlers.onOpen?.(connection);
      } catch (error) {
        ws.close(1011, error instanceof Error ? error.message : String(error));
        settle(error);
      }
    });
    ws.addEventListener("message", async (event) => {
      try {
        const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        await handlers.onMessage(data, connection);
      } catch (error) {
        ws.close(1011, error instanceof Error ? error.message : String(error));
        settle(error);
      }
    });
    ws.addEventListener("close", async () => {
      try {
        await handlers.onClose?.();
        settle();
      } catch (error) {
        settle(error);
      }
    });
    ws.addEventListener("error", () => settle(new RuntimeSessionError({ url: url.toString() })));
  }));
}

type RuntimeWebSocketConstructor = {
  new(url: string | URL, options?: { headers?: Record<string, string> }): WebSocket;
};

async function createRuntimeWebSocket(url: URL, token: string): Promise<WebSocket> {
  if (typeof Bun !== "undefined") {
    return new (WebSocket as unknown as RuntimeWebSocketConstructor)(url, {
      headers: { authorization: `Bearer ${token}` },
    });
  }

  const ws = await importWebSocketModule("ws") as {
    default?: RuntimeWebSocketConstructor;
    WebSocket?: RuntimeWebSocketConstructor;
  };
  const WebSocketConstructor = ws.default ?? ws.WebSocket;
  if (!WebSocketConstructor) {
    throw new RuntimeSessionError({ url: url.toString(), message: "No WebSocket implementation is available" });
  }
  return new WebSocketConstructor(url, {
    headers: { authorization: `Bearer ${token}` },
  });
}

const importWebSocketModule = new Function("specifier", "return import(specifier)") as (
  specifier: string,
) => Promise<unknown>;

function defaultHello(): RuntimeSessionHello {
  return {
    type: "hello",
    transportVersion: 1,
    host: {
      name: "rigkit-runtime-client",
      version: "0.0.0",
    },
    hostMethods: [],
    hostCapabilities: [],
  };
}
