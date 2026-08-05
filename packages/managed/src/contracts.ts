import { z } from "zod";

export const GitHubProjectSourceSchema = z.object({
  kind: z.literal("github"),
  owner: z.string().trim().min(1),
  repository: z.string().trim().min(1),
  url: z.url().optional(),
});

export const LocalProjectSourceSchema = z.object({
  kind: z.literal("local"),
  machineId: z.string().trim().min(1),
  machineName: z.string().trim().min(1),
  path: z.string().trim().min(1),
});

export const ProjectSourceSchema = z.discriminatedUnion("kind", [
  GitHubProjectSourceSchema,
  LocalProjectSourceSchema,
]);

export const ManagedProjectSchema = z.object({
  id: z.uuid(),
  slug: z.string().min(1),
  name: z.string().min(1),
  source: ProjectSourceSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const CreateProjectRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(63)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .optional(),
  source: ProjectSourceSchema,
  forceNew: z.boolean().optional(),
});

export const ProjectResponseSchema = z.object({ project: ManagedProjectSchema });
export const ProjectListResponseSchema = z.object({ projects: z.array(ManagedProjectSchema) });

export const ManagedDeviceSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  createdAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime(),
});

export const RegisterDeviceRequestSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(120),
});

export const ManagedCheckoutSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  deviceId: z.string().min(1),
  deviceName: z.string().min(1),
  path: z.string().min(1),
  gitRemote: z.string().min(1).nullable().optional(),
  createdAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime(),
});

export const RegisterCheckoutRequestSchema = z.object({
  projectId: z.uuid(),
  deviceId: z.string().min(1),
  path: z.string().min(1),
  gitRemote: z.string().trim().min(1).optional(),
  relink: z.boolean().optional(),
});

export const DeviceResponseSchema = z.object({ device: ManagedDeviceSchema });
export const CheckoutResponseSchema = z.object({ checkout: ManagedCheckoutSchema });
export const CheckoutListResponseSchema = z.object({ checkouts: z.array(ManagedCheckoutSchema) });

export const ManagedWorkspaceSchema = z.object({
  id: z.string().min(1),
  projectId: z.uuid(),
  name: z.string().min(1),
  workflow: z.string().min(1),
  sourceRevision: z.string().regex(/^[a-f0-9]{40}$/i).optional(),
  cacheEntryIds: z.array(z.string().min(1)).optional(),
  ctx: z.record(z.string(), z.unknown()),
  operations: z.array(z.object({
    id: z.string().min(1),
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    inputSchema: z.record(z.string(), z.unknown()).optional(),
    requiredCapabilities: z.array(z.object({
      id: z.string().min(1),
      schemaHash: z.string().optional(),
    })),
  })),
  createdFrom: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("checkout"),
      deviceId: z.string().min(1),
      deviceName: z.string().min(1),
      checkoutId: z.uuid().optional(),
      checkoutPath: z.string().min(1).optional(),
    }),
    z.object({ kind: z.literal("dashboard") }),
  ]),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const ProjectWorkspaceListResponseSchema = z.object({
  workspaces: z.array(ManagedWorkspaceSchema),
});

export const ManagedUserSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  email: z.email(),
  image: z.url().nullable().optional(),
});

export const CurrentUserResponseSchema = z.object({ user: ManagedUserSchema });

export const CreateManagedSandboxRequestSchema = z.object({
  projectId: z.uuid(),
  source: z.discriminatedUnion("type", [
    z.object({ type: z.literal("empty") }),
    z.object({
      type: z.literal("snapshot"),
      snapshotId: z.string().trim().min(1),
    }),
  ]),
  runtime: z.string().trim().min(1).default("node24"),
  ports: z.array(z.number().int().min(1).max(65_535)).max(4).default([]),
  timeout: z.number().int().min(60_000).max(3_600_000).optional(),
  resources: z.object({ vcpus: z.number().int().min(1).max(8) }).optional(),
});

export const ManagedSandboxSchema = z.object({
  name: z.string().min(1),
  domains: z.record(z.string(), z.url()),
});

export const ManagedSandboxResponseSchema = z.object({ sandbox: ManagedSandboxSchema });

export const CreateManagedSandboxSnapshotRequestSchema = z.object({
  projectId: z.uuid(),
  expiration: z.number().int().nonnegative().optional(),
});

export const ManagedSandboxSnapshotSchema = z.object({
  snapshotId: z.string().min(1),
});

export const ManagedSandboxSnapshotResponseSchema = z.object({
  snapshot: ManagedSandboxSnapshotSchema,
});

export const RunManagedSandboxCommandRequestSchema = z.object({
  projectId: z.uuid(),
  cmd: z.string().trim().min(1),
  args: z.array(z.string()).default([]),
  cwd: z.string().min(1).optional(),
  env: z.record(z.string(), z.string()).optional(),
  detached: z.boolean().default(false),
  timeoutMs: z.number().int().positive().max(600_000).optional(),
});

export const ManagedSandboxCommandResponseSchema = z.object({
  exitCode: z.number().int().nullable(),
  stdout: z.string(),
  stderr: z.string(),
});

export const OpenManagedSandboxInteractiveRequestSchema = z.object({
  projectId: z.uuid(),
});

export const ManagedSandboxInteractiveResponseSchema = z.object({
  url: z.url(),
  token: z.string().min(1),
});

export const ManagedRunStatusSchema = z.enum([
  "running",
  "completed",
  "failed",
  "orphaned",
]);

export const ManagedRunOperationSchema = z.enum(["plan", "apply", "create", "remove", "run"]);
export const ManagedRunOriginSchema = z.enum(["machine", "cli", "dashboard"]);

export const ManagedRunSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  checkoutId: z.uuid().optional(),
  deviceId: z.string().min(1).optional(),
  deviceName: z.string().min(1).optional(),
  origin: ManagedRunOriginSchema,
  operation: ManagedRunOperationSchema,
  workflow: z.string().min(1),
  workspace: z.string().min(1).optional(),
  workspaceOperation: z.string().min(1).optional(),
  fingerprint: z.string().min(1),
  status: ManagedRunStatusSchema,
  nodeCount: z.number().int().nonnegative().optional(),
  cachedNodeCount: z.number().int().nonnegative().optional(),
  error: z.string().nullable().optional(),
  startedAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable().optional(),
});

export const ManagedRunEventSchema = z.object({
  id: z.number().int().positive(),
  runId: z.uuid(),
  type: z.string().min(1).max(100),
  data: z.record(z.string(), z.unknown()),
  createdAt: z.iso.datetime(),
});

export const ClaimRunRequestSchema = z.object({
  projectId: z.uuid(),
  checkoutId: z.uuid(),
  operation: ManagedRunOperationSchema,
  workflow: z.string().trim().min(1).max(120).default("default"),
  fingerprint: z.string().min(1).max(255),
});

export const ClaimRunResponseSchema = z.object({
  run: ManagedRunSchema,
  disposition: z.enum(["created", "joined"]),
  socketUrl: z.url(),
});

export const RunListResponseSchema = z.object({ runs: z.array(ManagedRunSchema) });
export const RunResponseSchema = z.object({ run: ManagedRunSchema });
export const RunEventsResponseSchema = z.object({ events: z.array(ManagedRunEventSchema) });
export const RunSocketTicketResponseSchema = z.object({ socketUrl: z.url() });
export const RespondRunCapabilityRequestSchema = z.object({
  result: z.record(z.string(), z.unknown()),
});
export const RespondRunCapabilityResponseSchema = z.object({ event: ManagedRunEventSchema });

const RemoteWorkflowSchema = z.string().trim().min(1).max(120).optional();
const RemoteOriginSchema = z.enum(["cli", "dashboard"]).default("cli");

export const RemoteExecutionRequestSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("plan"), workflow: RemoteWorkflowSchema, origin: RemoteOriginSchema }),
  z.object({
    operation: z.literal("apply"),
    workflow: RemoteWorkflowSchema,
    dryRun: z.boolean().optional(),
    origin: RemoteOriginSchema,
  }),
  z.object({
    operation: z.literal("create"),
    workflow: RemoteWorkflowSchema,
    workspace: z.string().trim().min(1).max(120),
    origin: RemoteOriginSchema,
  }),
  z.object({
    operation: z.literal("remove"),
    workflow: z.string().trim().min(1).max(120),
    workspace: z.string().trim().min(1).max(120),
    origin: RemoteOriginSchema,
  }),
  z.object({
    operation: z.literal("run"),
    workflow: z.string().trim().min(1).max(120),
    workspace: z.string().trim().min(1).max(120),
    workspaceOperation: z.string().trim().min(1).max(120),
    input: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
    origin: RemoteOriginSchema,
  }),
]);

export const ManagedCacheEntrySchema = z.object({
  id: z.string().min(1),
  scope: z.string().min(1),
  workflow: z.string().min(1),
  nodePath: z.string().min(1),
  nodeName: z.string().min(1),
  nodeKind: z.string().min(1),
  fingerprint: z.string().min(1),
  upstreamRunIds: z.array(z.string().min(1)),
  invalidated: z.boolean(),
  createdAt: z.iso.datetime(),
});

export const ProjectCacheResponseSchema = z.object({
  revision: z.number().int().nonnegative(),
  entries: z.array(ManagedCacheEntrySchema),
});

export const InvalidateProjectCacheRequestSchema = z.object({
  scope: z.string().min(1),
  entryId: z.string().min(1),
});

export const ProjectCacheMutationResponseSchema = z.object({
  revision: z.number().int().nonnegative(),
  affected: z.number().int().nonnegative(),
});

export const RemoteExecutionResponseSchema = z.object({
  run: ManagedRunSchema,
  disposition: z.enum(["created", "joined"]),
  result: z.unknown().optional(),
});

export const ManagedStateScopeSchema = z.object({
  workspaces: z.array(z.unknown()),
  workflowApplies: z.array(z.unknown()),
  nodeRuns: z.array(z.unknown()),
  providerState: z.array(z.unknown()),
});

export const ManagedProjectStateSnapshotSchema = z.object({
  version: z.literal(1),
  scopes: z.record(z.string(), ManagedStateScopeSchema),
});

export const ProjectStateResponseSchema = z.object({
  revision: z.number().int().nonnegative(),
  snapshot: ManagedProjectStateSnapshotSchema,
});

export const UpdateProjectStateRequestSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  snapshot: ManagedProjectStateSnapshotSchema,
});

export type GitHubProjectSource = z.infer<typeof GitHubProjectSourceSchema>;
export type LocalProjectSource = z.infer<typeof LocalProjectSourceSchema>;
export type ProjectSource = z.infer<typeof ProjectSourceSchema>;
export type ManagedProject = z.infer<typeof ManagedProjectSchema>;
export type CreateProjectRequest = z.infer<typeof CreateProjectRequestSchema>;
export type ManagedUser = z.infer<typeof ManagedUserSchema>;
export type CreateManagedSandboxRequest = z.infer<typeof CreateManagedSandboxRequestSchema>;
export type ManagedSandbox = z.infer<typeof ManagedSandboxSchema>;
export type CreateManagedSandboxSnapshotRequest = z.infer<typeof CreateManagedSandboxSnapshotRequestSchema>;
export type ManagedSandboxSnapshot = z.infer<typeof ManagedSandboxSnapshotSchema>;
export type RunManagedSandboxCommandRequest = z.infer<typeof RunManagedSandboxCommandRequestSchema>;
export type ManagedSandboxCommandResponse = z.infer<typeof ManagedSandboxCommandResponseSchema>;
export type ManagedSandboxInteractiveResponse = z.infer<typeof ManagedSandboxInteractiveResponseSchema>;
export type ManagedDevice = z.infer<typeof ManagedDeviceSchema>;
export type RegisterDeviceRequest = z.infer<typeof RegisterDeviceRequestSchema>;
export type ManagedCheckout = z.infer<typeof ManagedCheckoutSchema>;
export type ManagedWorkspace = z.infer<typeof ManagedWorkspaceSchema>;
export type RegisterCheckoutRequest = z.infer<typeof RegisterCheckoutRequestSchema>;
export type ManagedRunStatus = z.infer<typeof ManagedRunStatusSchema>;
export type ManagedRunOperation = z.infer<typeof ManagedRunOperationSchema>;
export type ManagedRunOrigin = z.infer<typeof ManagedRunOriginSchema>;
export type ManagedRun = z.infer<typeof ManagedRunSchema>;
export type ManagedRunEvent = z.infer<typeof ManagedRunEventSchema>;
export type RespondRunCapabilityRequest = z.infer<typeof RespondRunCapabilityRequestSchema>;
export type RespondRunCapabilityResponse = z.infer<typeof RespondRunCapabilityResponseSchema>;
export type ClaimRunRequest = z.infer<typeof ClaimRunRequestSchema>;
export type ClaimRunResponse = z.infer<typeof ClaimRunResponseSchema>;
export type RemoteExecutionRequest = z.infer<typeof RemoteExecutionRequestSchema>;
export type RemoteExecutionResponse = z.infer<typeof RemoteExecutionResponseSchema>;
export type ManagedCacheEntry = z.infer<typeof ManagedCacheEntrySchema>;
export type ProjectCacheResponse = z.infer<typeof ProjectCacheResponseSchema>;
export type InvalidateProjectCacheRequest = z.infer<typeof InvalidateProjectCacheRequestSchema>;
export type ProjectCacheMutationResponse = z.infer<typeof ProjectCacheMutationResponseSchema>;
export type ManagedProjectStateSnapshot = z.infer<typeof ManagedProjectStateSnapshotSchema>;
export type ProjectStateResponse = z.infer<typeof ProjectStateResponseSchema>;
export type UpdateProjectStateRequest = z.infer<typeof UpdateProjectStateRequestSchema>;
