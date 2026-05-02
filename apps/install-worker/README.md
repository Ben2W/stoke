# fdev install worker

Cloudflare Worker for `fdev.freestyle.sh`.

GitHub Releases are the source of truth. The worker serves install and metadata endpoints, caches release metadata at the edge, and redirects downloads to GitHub release assets.

```text
GET /install
GET /latest
GET /latest.json
GET /download/:version/:target
GET /checksums/:version
```

No R2 bucket is used.

Deploy:

```sh
pnpm --filter @freestyle-sh/fdev-install-worker deploy
```

`wrangler.toml` binds the worker to `fdev.freestyle.sh`. Deployment requires Cloudflare auth with access to the `freestyle.sh` zone.
