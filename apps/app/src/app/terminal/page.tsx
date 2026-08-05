"use client";

import { WorkspaceTerminalPage } from "../../components/terminal/workspace-terminal-page.tsx";

export default async function TerminalPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  return (
    <WorkspaceTerminalPage
      projectId={singleValue(query.project)}
      sandbox={singleValue(query.sandbox)}
      title={singleValue(query.title) ?? "SSH"}
      cwd={singleValue(query.cwd) ?? "/vercel/sandbox"}
    />
  );
}

function singleValue(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
