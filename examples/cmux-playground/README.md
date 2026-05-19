# cmux Playground Example

Minimal Rigkit workflow for testing local cmux integration.

After `rig create`, run `rig run cmux-playground open` to ask the local rigkit host to create a cmux workspace and run:

```bash
echo hello world
```

Run from this directory:

```bash
rig plan
rig apply
rig create cmux-playground
rig run cmux-playground open
```

Freestyle auth is handled by the provider. By default Rigkit opens the Freestyle browser login. The local `cmux` CLI/app must be installed.

cmux socket commands are routed through the rigkit host capability registered by the CLI. That keeps the socket call in the terminal process that ran `rig`, instead of in rigkit's detached project runtime, which may have been started before the current cmux terminal environment existed.
