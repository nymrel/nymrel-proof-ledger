# In-memory work and earnings simulation

See the [prototype guide](../README.md) for setup, commands, lifecycle, accounting,
authority boundaries and activation requirements. This directory contains the
deterministic fake-credit engine, saved-page comparator, synthetic fixtures,
human/JSON demo, worker-only JSONL CLI and replay CLI.

The engine creates no database. Use the [durable wrapper](../agent-work-durable/README.md)
for local SQLite recovery. Both variants remain offline simulations and are
excluded from stable package distributions. All source is covered by the
repository [MIT license](../../LICENSE).
