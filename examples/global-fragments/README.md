# Global Fragment Cache Example

This example has three separate Rigkit configs that all import the same globally
scoped base graph:

- `api.rig.config.ts`
- `web.rig.config.ts`
- `worker.rig.config.ts`

The shared graph lives in `shared/base-dependencies.ts` and is marked with
`.global()`. Its configured inputs are part of the fragment fingerprint, so all
three configs reuse the same global fragment while their service-specific setup
stays local to each config.

Run one config:

```sh
rig -config=api.rig.config.ts apply
rig -config=api.rig.config.ts cache ls
```

Then run another:

```sh
rig -config=web.rig.config.ts apply
rig -config=web.rig.config.ts cache ls
```

The shared `base-dependencies` tasks should be cached globally, while each
service's `install-service` task remains local to that config.

Clear every global fragment without loading a config:

```sh
rig cache clear --global --all
```
