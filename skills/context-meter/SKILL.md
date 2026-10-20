---
name: context-meter
description: Open the local Context Meter panel to inspect an explicitly selected Codex rollout record's token usage, context estimate, and prompt cache hit rate.
---

Use this plugin's `open_monitor` tool to open the actual MCP App. Ask the user to choose a session in its selector. Never infer the active session from modification time.

The panel refreshes through app-only tools without repeated model calls. Do not create a recurring task or send periodic chat messages.

Choose the opaque record reference, not just a session ID: forks or copied rollouts can share an ID. The panel lists these records separately. Missing data is unavailable, not zero. Context usage is an estimate based on the latest reported total and model window; cumulative tokens are not current context size. Cached input still occupies context.

The first scan processes history in bounded batches; wait for catch-up before interpreting the latest metrics. Compaction marks old values until new usage arrives. Subsequent scans read newly appended data. Logs are not modified or uploaded.
