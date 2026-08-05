export const dashboardRoutes = {
  projects: "/projects",
  project: (projectSlug: string) => `/projects/${encodeURIComponent(projectSlug)}`,
  projectRuns: (projectSlug: string) => `/projects/${encodeURIComponent(projectSlug)}/runs`,
  workspace: (projectSlug: string, workspaceId: string) =>
    `/projects/${encodeURIComponent(projectSlug)}/workspaces/${encodeURIComponent(workspaceId)}`,
  workspaceRuns: (projectSlug: string, workspaceId: string) =>
    `/projects/${encodeURIComponent(projectSlug)}/workspaces/${encodeURIComponent(workspaceId)}/runs`,
};
