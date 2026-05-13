import { Buffer } from "node:buffer";

type Probe = {
  name: string;
  method: string;
  path: string;
  body?: unknown;
  okStatuses: number[];
  explanation: string;
};

const token = process.env.RELEASE_BOT_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;

if (!token) {
  throw new Error(
    "Missing RELEASE_BOT_TOKEN secret. Add a token with Contents, Workflows, and Pull requests write permissions.",
  );
}

if (!repository) {
  throw new Error("Missing GITHUB_REPOSITORY.");
}

const [owner, repo] = repository.split("/");
if (!owner || !repo) {
  throw new Error(`Invalid GITHUB_REPOSITORY: ${repository}`);
}

async function request(probe: Probe) {
  const response = await fetch(`https://api.github.com${probe.path}`, {
    method: probe.method,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-github-api-version": "2022-11-28",
    },
    body: probe.body === undefined ? undefined : JSON.stringify(probe.body),
  });

  const text = await response.text();
  if (probe.okStatuses.includes(response.status)) {
    console.log(`ok: ${probe.name}`);
    return;
  }

  let message = text;
  try {
    message = JSON.parse(text).message ?? text;
  } catch {
    // Keep the raw response text.
  }

  throw new Error(
    [
      `Release bot token permission check failed: ${probe.name}`,
      `Expected HTTP ${probe.okStatuses.join(" or ")}, got ${response.status}.`,
      probe.explanation,
      message ? `GitHub response: ${message}` : undefined,
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

const base = `/repos/${owner}/${repo}`;
const base64Noop = Buffer.from("# rigkit permission check\n").toString("base64");

const probes: Probe[] = [
  {
    name: "repository access",
    method: "GET",
    path: base,
    okStatuses: [200],
    explanation: `The token must be scoped to ${repository}.`,
  },
  {
    name: "contents:write",
    method: "PUT",
    path: `${base}/contents/package.json`,
    body: {
      message: "Rigkit permission check",
      content: base64Noop,
    },
    okStatuses: [422],
    explanation:
      "The token needs repository Contents read/write. HTTP 422 is expected because the existing file SHA is intentionally omitted, so no file is changed.",
  },
  {
    name: "workflows:write",
    method: "PUT",
    path: `${base}/contents/.github/workflows/prepare-minor-release.yml`,
    body: {
      message: "Rigkit permission check",
      content: base64Noop,
    },
    okStatuses: [422],
    explanation:
      "The token needs repository Workflows read/write. HTTP 422 is expected because the existing workflow file SHA is intentionally omitted, so no file is changed.",
  },
  {
    name: "pull-requests:write",
    method: "POST",
    path: `${base}/pulls`,
    body: {
      title: "Rigkit permission check",
      head: "__rigkit_missing_head__",
      base: "__rigkit_missing_base__",
    },
    okStatuses: [422],
    explanation:
      "The token needs Pull requests read/write. HTTP 422 is expected because the source and base branches are intentionally invalid, so no PR is created.",
  },
];

for (const probe of probes) {
  await request(probe);
}

console.log("Release bot token permissions passed.");
