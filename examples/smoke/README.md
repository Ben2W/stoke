# Smoke Example

This example defines a single provider-free `smoke` workflow with one cached
setup step, one workspace lifecycle, and one workspace operation.

Run from this directory:

```bash
rig plan
rig apply
rig create smoke-workspace
rig projects
rig run smoke-workspace ssh --print
```

During `rig apply`, `rig` runs the setup step and stores the generated workflow
context in the local project state.
