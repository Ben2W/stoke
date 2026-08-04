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
});

export const ProjectResponseSchema = z.object({ project: ManagedProjectSchema });
export const ProjectListResponseSchema = z.object({ projects: z.array(ManagedProjectSchema) });

export const ManagedUserSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  email: z.email(),
  image: z.url().nullable().optional(),
});

export const CurrentUserResponseSchema = z.object({ user: ManagedUserSchema });

export type GitHubProjectSource = z.infer<typeof GitHubProjectSourceSchema>;
export type LocalProjectSource = z.infer<typeof LocalProjectSourceSchema>;
export type ProjectSource = z.infer<typeof ProjectSourceSchema>;
export type ManagedProject = z.infer<typeof ManagedProjectSchema>;
export type CreateProjectRequest = z.infer<typeof CreateProjectRequestSchema>;
export type ManagedUser = z.infer<typeof ManagedUserSchema>;
