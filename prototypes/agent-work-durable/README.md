# Durable local simulation wrapper

See the [prototype guide](../README.md) for setup, exact commands, recovery tests,
trusted-filesystem limits and activation requirements. This directory wraps the
unchanged [in-memory engine](../agent-work/README.md) with tenant-bound local
SQLite transactions and separate actor capabilities.

Node 24–26 is required by this experimental wrapper. It provides no public
endpoint, genuine actor authentication, external database or payment adapter.
`test-worker.ts` is a trusted crash/concurrency subprocess fixture, not a service
entry point. Source and compiled prototypes remain excluded from stable packages.
The repository [MIT license](../../LICENSE) applies.
