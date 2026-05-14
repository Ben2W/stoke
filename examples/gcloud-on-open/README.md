# Gcloud Injection Example

This example demonstrates copying local gcloud config/auth files into a workspace without giving rigkit its own Google OAuth client.

The workflow:

- requires local `gcloud` to be installed and authenticated before any rigkit command runs
- creates a Freestyle VM
- installs the Google Cloud CLI inside the VM
- creates a workspace VM from that snapshot
- copies selected files from the local gcloud config directory during workspace creation
- opens an interactive SSH session

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

Freestyle auth is handled by the provider. By default Rigkit opens the Freestyle browser login.
