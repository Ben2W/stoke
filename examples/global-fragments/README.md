# Global Fragment Cache Example

This example has three workflows that all import the same globally scoped base
graph:

- `api`
- `web`
- `worker`

The shared graph lives in `shared/base-dependencies.ts` and is marked with
`.global()`. Its configured inputs are part of the fragment fingerprint, so all
three workflows reuse the same global fragment while their service-specific
setup stays local to each workflow.

Run one workflow:

```sh
rig apply --workflow api
rig cache ls
```

Then run another:

```sh
rig apply --workflow web
rig cache ls
```

The shared `base-dependencies` tasks should be cached globally, while each
service's `install-service` task remains local to that workflow.

Clear every global fragment without loading a config:

```sh
rig cache clear --global --all
```
