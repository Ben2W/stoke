# @freestyle-sh/fdev-engine

Runtime engine for fdev workflows.

This package loads `fdev.config.ts`, evaluates workflow nodes, manages graph-based `.fdev/state.sqlite` node-run cache, runs workspace lifecycle hooks, talks to registered workflow providers, presents provider-owned interaction URLs, and exposes APIs used by the CLI and future app.
