import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { bearer, deviceAuthorization } from "better-auth/plugins";
import { getDatabase } from "./db/client.ts";
import * as schema from "./db/schema.ts";
import { verifySandboxTicket } from "./sandbox-tickets.ts";

export const STOKE_CLI_CLIENT_ID = "stoke-cli";

export class AuthenticationError extends Error {
  override name = "AuthenticationError";
}

let authInstance: ReturnType<typeof createStokeAuth> | undefined;

export function getStokeAuth(): ReturnType<typeof createStokeAuth> {
  authInstance ??= createStokeAuth();
  return authInstance;
}

export function createStokeAuth() {
  const githubClientId = process.env.GITHUB_CLIENT_ID;
  const githubClientSecret = process.env.GITHUB_CLIENT_SECRET;

  return betterAuth({
    appName: "Stoke",
    baseURL: stokeBaseUrl(),
    basePath: "/api/auth",
    secret: authSecret(),
    database: drizzleAdapter(getDatabase(), {
      provider: "pg",
      schema,
    }),
    socialProviders:
      githubClientId && githubClientSecret
        ? {
            github: {
              clientId: githubClientId,
              clientSecret: githubClientSecret,
            },
          }
        : {},
    plugins: [
      bearer(),
      deviceAuthorization({
        verificationUri: "/device",
        validateClient: async (clientId) => clientId === STOKE_CLI_CLIENT_ID,
      }),
    ],
    trustedOrigins: [stokeBaseUrl()],
  });
}

export async function authenticateRequest(request: Request) {
  const authorization = request.headers.get("authorization");
  const sandbox = authorization?.startsWith("Bearer ")
    ? verifySandboxTicket(authorization.slice("Bearer ".length))
    : undefined;
  if (sandbox) {
    return {
      id: sandbox.userId,
      name: "Stoke Sandbox",
      email: "sandbox@usestoke.dev",
      emailVerified: true,
      image: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
      sandboxProjectId: sandbox.projectId,
    };
  }
  const session = await getStokeSession(request.headers);
  if (!session) throw new AuthenticationError("Authentication required");
  return session.user;
}

export async function getStokeSession(headers: Headers) {
  return await getStokeAuth().api.getSession({ headers });
}

function stokeBaseUrl(): string {
  if (process.env.BETTER_AUTH_URL) return process.env.BETTER_AUTH_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

function authSecret(): string {
  if (process.env.BETTER_AUTH_SECRET) return process.env.BETTER_AUTH_SECRET;
  if (process.env.NODE_ENV !== "production") return "stoke-development-only-secret-change-me";
  throw new Error("BETTER_AUTH_SECRET is not configured");
}
