# rig install worker

Cloudflare Worker for `rig.freestyle.sh` and `rigkit.freestyle.sh`.

GitHub Releases are the source of truth. The worker serves install and metadata endpoints, caches release metadata at the edge, and redirects downloads to GitHub release assets.

```text
GET /install
GET /latest
GET /latest.json
GET /download/:version/:target
GET /checksums/:version
```

No R2 bucket is used.

Set a GitHub token as a Worker secret so release metadata requests do not rely on anonymous GitHub API quota:

```sh
pnpm --filter @rigkit/install-worker exec wrangler secret put GITHUB_TOKEN
```

A fine-grained, read-only token scoped to `freestyle-sh/rigkit` is enough.

For local development, copy `.dev.vars.example` to `.dev.vars` and set the same value there. `.dev.vars` is ignored by git.

Deploy:

```sh
pnpm --filter @rigkit/install-worker deploy
```

`wrangler.toml` binds the worker to both hostnames. `rigkit.freestyle.sh` is the canonical URL used in generated install and metadata links. Deployment requires Cloudflare auth with access to the `freestyle.sh` zone.
