# @rigkit/engine

Runtime engine for Rigkit workflows.

This package loads `rigkit/index.ts`, evaluates workflow nodes against a serializable in-memory state snapshot, runs workspace lifecycle hooks, talks to registered workflow providers, presents provider-owned interaction URLs, and exposes APIs used by the Stoke runtime. Durable workflow state belongs to the managed Postgres control plane.
