# @freestyle/fdev

Shared engine and CLI for Freestyle dev machines.

```bash
fdev help
fdev init
fdev plan
fdev apply
fdev fork --name smoke-workspace
fdev ls
fdev ssh smoke-workspace --print
```

By default, `fdev` loads `fdev.config.ts` from the current directory. Use `-C <dir>` for another project directory or `--config <file>` for an exact config file.

The CLI uses Commander for parsing and help text. Execution flows through `DevMachineEngine` so a future app can call the same engine.
