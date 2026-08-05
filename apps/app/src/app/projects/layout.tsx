"use client";

import { DashboardShell } from "./_components/dashboard-shell.tsx";

export default function ProjectsLayout({ children }: { children: React.ReactNode }) {
  return <DashboardShell>{children}</DashboardShell>;
}
