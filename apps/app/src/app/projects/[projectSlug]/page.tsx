"use client";

import { useParams } from "next/navigation";
import { ProjectPage } from "./_components/project-page.tsx";

export default function Page() {
  const { projectSlug } = useParams<{ projectSlug: string }>();
  return <ProjectPage projectSlug={projectSlug} />;
}
