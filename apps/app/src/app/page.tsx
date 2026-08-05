import { headers } from "next/headers";
import { ProjectDashboard } from "../components/dashboard/project-dashboard.tsx";
import { LandingPage } from "../components/landing/landing-page.tsx";
import { getStokeSession } from "../server/auth.ts";
import { listCheckouts } from "../server/devices.ts";
import { listProjects } from "../server/projects.ts";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getStokeSession(await headers());

  if (!session) return <LandingPage />;

  const [projects, checkouts] = await Promise.all([
    listProjects(session.user.id),
    listCheckouts(session.user.id),
  ]);

  return (
    <ProjectDashboard
      user={session.user}
      projects={projects}
      checkouts={checkouts}
    />
  );
}
