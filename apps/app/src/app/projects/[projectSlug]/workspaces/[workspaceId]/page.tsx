"use client";

import { useParams } from "next/navigation";
import { WorkspacePage } from "./_components/workspace-page.tsx";

export default function Page() {
  const { projectSlug, workspaceId } = useParams<{ projectSlug: string; workspaceId: string }>();
  return <WorkspacePage projectSlug={projectSlug} workspaceId={workspaceId} />;
}
