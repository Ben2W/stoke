# @freestyle/fdev

Shared engine and CLI for Freestyle dev machines.

```bash
fdev help
fdev plan smoke
fdev apply smoke
fdev fork smoke --name smoke-workspace
fdev terminal smoke-workspace --print
```

The CLI is intentionally thin. Execution flows through `DevMachineEngine` so a future app can call the same engine.

