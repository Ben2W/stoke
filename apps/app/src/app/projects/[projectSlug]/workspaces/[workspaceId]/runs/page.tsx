"use client";

import { useParams } from "next/navigation";
import { WorkspaceRunsPage } from "./_components/workspace-runs-page.tsx";

export default function Page() {
  const { projectSlug, workspaceId } = useParams<{ projectSlug: string; workspaceId: string }>();
  return <WorkspaceRunsPage projectSlug={projectSlug} workspaceId={workspaceId} />;
}
