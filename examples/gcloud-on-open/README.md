# Gcloud On-Open Example

This example demonstrates copying local gcloud config/auth files into a workspace without giving rigkit its own Google OAuth client.

The workflow:

- requires local `gcloud` to be installed and authenticated before any rigkit command runs
- creates a Freestyle VM
- installs the Google Cloud CLI inside the VM
- forks a workspace from that VM snapshot
- runs `workspace.onOpen` before `rig ssh`
- copies selected files from the local gcloud config directory into the workspace
- prints the SSH command

Before running:

```bash
gcloud auth login
```

Run from this directory:

```bash
pnpm rig:plan
pnpm rig:apply
pnpm rig:fork
pnpm rig:ssh
```

Inside the VM, verify the synced auth with:

```bash
gcloud auth list
gcloud auth print-access-token >/dev/null
```

The Freestyle API key is read from `FREESTYLE_API_KEY`.
