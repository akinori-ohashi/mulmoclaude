# fix: stdio→HTTP shim leaks its port when the grandchild survives (#3357)

## Cause

`startStdioHttpShim` spawns `npx supergateway …`; the port is bound by a
grandchild (`npm exec` → `sh -c` → `supergateway`). `close()` sent SIGTERM to
the `npx` process only, and nothing guarantees it reaches the grandchild. When it
does not, the port stays bound for the life of the host, and after
`MAX_PORT_PROBES` such turns every new turn drops the server.

## Fix

- Spawn the shim with `detached: true` so it leads its own process group.
- `close()` (`createShimCloser`) sends SIGTERM to the group, then SIGKILL to the
  group after a grace period.
- Because the group no longer receives a terminal's Ctrl+C, every still-live
  group is SIGKILLed on the server's `exit` (`killAllShimGroups`).
- The group signal goes through `signalProcessGroup` (`server/agent/processGroup.ts`),
  which refuses unset / non-positive / `1` pids — `kill(-0)` and `kill(-1)` would
  hit our own group or every process.

## Out of scope

- Reusing shims across turns, a port-release check after close, surfacing
  "no free port" in the UI (suggestions 3–5 in the issue).
- Reaping orphans left by a version without this fix: they need a restart or the
  issue's workaround script once.

## Verification

- `test/agent/test_process_group.ts`: the pid guard, both directions.
- `test/agent/test_stdio_http_shim_close.ts`: a real `sh → sh → sleep` tree; the
  grandchild must die, including when SIGTERM is ignored. Swapping the closer
  back to `child.kill` turns it red.
- Manual: `startStdioHttpShim` with the real supergateway + `server-memory`,
  several turns in a row — the same port is reused each turn and no member of
  any shim's process group is left.
