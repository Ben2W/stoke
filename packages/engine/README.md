# @rigkit/engine

Runtime engine for Rigkit workflows.

This package loads `rigkit/index.ts`, evaluates workflow nodes, manages graph-based `.rigkit/state.sqlite` node-run cache, runs workspace lifecycle hooks, talks to registered workflow providers, presents provider-owned interaction URLs, and exposes APIs used by the CLI and future app.
