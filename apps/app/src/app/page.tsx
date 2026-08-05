import type { ManagedCheckout, ManagedProject } from "@stoke/managed";
import { headers } from "next/headers";
import { SignInButton, SignOutButton } from "./auth-actions.tsx";
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
  return <Dashboard user={session.user} projects={projects} checkouts={checkouts} />;
}

function LandingPage() {
  return (
    <main className="site-shell">
      <SiteHeader action={<SignInButton />} />

      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <div className="kicker"><span className="signal-dot" /> Private preview</div>
          <h1 id="hero-title">One project identity. Everywhere code runs.</h1>
          <p className="hero-lede">
            Stoke connects local checkouts, coding agents, and CI to the same managed
            development environment—without moving your TypeScript workflow into the cloud.
          </p>
          <div className="hero-actions">
            <SignInButton />
            <a className="button button-secondary" href="#model">See how it works <span aria-hidden="true">↓</span></a>
          </div>
          <div className="platform-note">
            <span>Built for Vercel</span>
            <span>Better Auth</span>
            <span>Neon Postgres</span>
          </div>
        </div>

        <div className="terminal-card" aria-label="Example Stoke terminal session">
          <div className="terminal-bar">
            <div className="terminal-dots" aria-hidden="true"><i /><i /><i /></div>
            <span>~/repos/stoke</span>
            <span className="terminal-live">live</span>
          </div>
          <div className="terminal-body">
            <TerminalCommand command="stoke add ." />
            <div className="terminal-response success">✓ linked <b>stoke</b></div>
            <TerminalDetail label="project" value="ben2w-stoke" />
            <TerminalDetail label="checkout" value="Benjamin’s MacBook · ~/repos/stoke" />
            <TerminalCommand command="stoke use ben2w-stoke" />
            <div className="terminal-response success">✓ using <b>stoke</b></div>
            <TerminalCommand command="stoke plan" />
            <div className="terminal-plan">
              <span><i className="plan-ready" /> workflow ready</span>
              <span>cache · 8/8</span>
            </div>
          </div>
          <div className="terminal-footer">
            <span>LOCAL</span><span className="flow-line" /><span>MANAGED</span><span className="flow-line pending" /><span>SANDBOX</span>
          </div>
        </div>
      </section>

      <section className="identity-section" id="model" aria-labelledby="model-title">
        <div className="section-heading">
          <div className="section-index">01 / THE MODEL</div>
          <h2 id="model-title">Your code has a home.<br />Your machines are just locations.</h2>
          <p>A project stays stable while devices, paths, and execution environments come and go.</p>
        </div>
        <div className="identity-grid">
          <IdentityCard number="01" title="Project" status="Managed" copy="The durable identity for a repository and its workflow state." example="github.com/ben2w/stoke" />
          <IdentityCard number="02" title="Device" status="Local" copy="A stable CLI installation on a laptop, runner, or agent host." example="Benjamin’s MacBook" />
          <IdentityCard number="03" title="Checkout" status="Linked" copy="One physical copy of a project on one registered device." example="~/repos/vercel/stoke" />
        </div>
      </section>

      <section className="workflow-section" aria-labelledby="workflow-title">
        <div className="section-index">02 / ONE WORKFLOW</div>
        <div className="workflow-heading">
          <h2 id="workflow-title">Define it once.<br />Run it where the work is.</h2>
          <p>Stoke keeps the typed Rigkit engine on the machine doing the work. The control plane coordinates identity, state, and cache metadata.</p>
        </div>
        <div className="workflow-rail">
          <WorkflowStage label="Today" title="Local + cmux" copy="Evaluate TypeScript locally and open agent workspaces in cmux." state="ready" />
          <WorkflowStage label="Today" title="Managed state" copy="Projects, devices, and checkouts follow the user across machines." state="ready" />
          <WorkflowStage label="Next" title="Vercel Sandbox" copy="Create remote environments from the same project and workflow identity." state="next" />
          <WorkflowStage label="Then" title="CI cache" copy="Let CI and local development reuse the same prepared work." state="future" />
        </div>
      </section>

      <section className="closing-cta">
        <div>
          <div className="section-index">PRIVATE PREVIEW</div>
          <h2>Start with the checkout you already have.</h2>
        </div>
        <div className="cta-command"><code><span>$</span> stoke add .</code><SignInButton /></div>
      </section>

      <SiteFooter />
    </main>
  );
}

function Dashboard({
  user,
  projects,
  checkouts,
}: {
  user: { name: string; email: string; image?: string | null };
  projects: ManagedProject[];
  checkouts: ManagedCheckout[];
}) {
  const deviceCount = new Set(checkouts.map((checkout) => checkout.deviceId)).size;

  return (
    <main className="site-shell dashboard-shell">
      <SiteHeader action={<div className="account-menu"><span>{user.email}</span><SignOutButton /></div>} />

      <section className="dashboard-hero">
        <div>
          <div className="kicker"><span className="signal-dot" /> Control plane online</div>
          <h1>Welcome back, {firstName(user.name)}.</h1>
          <p>Your managed projects and every place they are checked out.</p>
        </div>
        <div className="dashboard-stats" aria-label="Account summary">
          <Stat value={projects.length} label={projects.length === 1 ? "project" : "projects"} />
          <Stat value={deviceCount} label={deviceCount === 1 ? "device" : "devices"} />
          <Stat value={checkouts.length} label={checkouts.length === 1 ? "checkout" : "checkouts"} />
        </div>
      </section>

      <section className="project-section" aria-labelledby="projects-title">
        <div className="dashboard-section-heading">
          <div><div className="section-index">MANAGED PROJECTS</div><h2 id="projects-title">Projects</h2></div>
          <code className="inline-command">stoke add owner/repo</code>
        </div>

        {projects.length === 0 ? (
          <div className="empty-state">
            <span className="empty-mark">+</span>
            <h3>Add your first project</h3>
            <p>Open a repository in your terminal and connect its current checkout.</p>
            <code><span>$</span> stoke add .</code>
          </div>
        ) : (
          <div className="project-list">
            {projects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                checkouts={checkouts.filter((checkout) => checkout.projectId === project.id)}
              />
            ))}
          </div>
        )}
      </section>

      <section className="next-milestone">
        <div className="milestone-copy">
          <div className="section-index">NEXT MILESTONE</div>
          <h2>Run this project in Vercel Sandbox.</h2>
          <p>The project identity is ready. Remote execution is the next piece of the loop.</p>
        </div>
        <div className="milestone-command"><span className="soon-pill">COMING NEXT</span><code>stoke create review-184</code></div>
      </section>

      <SiteFooter />
    </main>
  );
}

function SiteHeader({ action }: { action: React.ReactNode }) {
  return (
    <header className="site-header">
      <a className="wordmark" href="/" aria-label="Stoke home"><span className="brand-mark" aria-hidden="true">S</span><b>STOKE</b></a>
      <nav aria-label="Primary navigation">
        <a href="#model">Model</a>
        <a href="https://www.rigkit.dev/docs/bash">Rigkit docs</a>
        {action}
      </nav>
    </header>
  );
}

function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="wordmark"><span className="brand-mark" aria-hidden="true">S</span><b>STOKE</b></div>
      <p>Managed development environments, exclusively on Vercel.</p>
      <span>Private preview · 2026</span>
    </footer>
  );
}

function TerminalCommand({ command }: { command: string }) {
  return <div className="terminal-command"><span>❯</span>{command}<i className="cursor" /></div>;
}

function TerminalDetail({ label, value }: { label: string; value: string }) {
  return <div className="terminal-detail"><span>{label}</span><b>{value}</b></div>;
}

function IdentityCard({ number, title, status, copy, example }: { number: string; title: string; status: string; copy: string; example: string }) {
  return (
    <article className="identity-card">
      <div className="card-top"><span>{number}</span><span className="status-pill">{status}</span></div>
      <div className="identity-icon" aria-hidden="true"><span>{title.slice(0, 1)}</span></div>
      <h3>{title}</h3><p>{copy}</p><code>{example}</code>
    </article>
  );
}

function WorkflowStage({ label, title, copy, state }: { label: string; title: string; copy: string; state: "ready" | "next" | "future" }) {
  return (
    <article className={`workflow-stage ${state}`}>
      <div className="stage-node"><i /></div>
      <span className="stage-label">{label}</span><h3>{title}</h3><p>{copy}</p>
    </article>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return <div className="stat"><strong>{String(value).padStart(2, "0")}</strong><span>{label}</span></div>;
}

function ProjectCard({ project, checkouts }: { project: ManagedProject; checkouts: ManagedCheckout[] }) {
  const source = project.source.kind === "github"
    ? `${project.source.owner}/${project.source.repository}`
    : project.source.path;
  const sourceUrl = project.source.kind === "github"
    ? project.source.url ?? `https://github.com/${source}`
    : undefined;

  return (
    <article className="project-card">
      <div className="project-main">
        <div className="project-avatar">{project.name.slice(0, 2).toUpperCase()}</div>
        <div>
          <div className="project-title-row"><h3>{project.name}</h3><span className="status-pill live">ACTIVE</span></div>
          {sourceUrl ? <a className="project-source" href={sourceUrl}>{source} <span aria-hidden="true">↗</span></a> : <span className="project-source">{source}</span>}
          <code className="project-slug">{project.slug}</code>
        </div>
      </div>
      <div className="checkout-list">
        <div className="checkout-heading"><span>CHECKOUTS</span><b>{String(checkouts.length).padStart(2, "0")}</b></div>
        {checkouts.length === 0 ? (
          <div className="checkout-empty">No local checkout linked</div>
        ) : checkouts.map((checkout) => (
          <div className="checkout-row" key={checkout.id}>
            <span className="device-indicator" aria-hidden="true" />
            <div><b>{checkout.deviceName}</b><code>{checkout.path}</code></div>
            <span className="last-seen">{relativeTime(checkout.lastSeenAt)}</span>
          </div>
        ))}
      </div>
      <div className="project-card-footer"><span>Updated {relativeTime(project.updatedAt)}</span><code>stoke use {project.slug}</code></div>
    </article>
  );
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

function relativeTime(value: string): string {
  const difference = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.round(difference / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}
