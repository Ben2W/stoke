"use client";

import { useParams } from "next/navigation";
import { ProjectRunsPage } from "./_components/project-runs-page.tsx";

export default function Page() {
  const { projectSlug } = useParams<{ projectSlug: string }>();
  return <ProjectRunsPage projectSlug={projectSlug} />;
}
