# feat(core/remote-host): machine fields in presence, hostId resolved after sign-in (#3505)

Core side of receptron/mulmoterminal#3092. The phone side shipped in receptron/mulmoserver#356.

## Changes

- `HostMachine { machineId, label }` and optional `machineId` / `label` on `HostPresence`.
  `buildHostPresence(channel, handlers, online, machine?)` adds them only when a machine is given,
  and copies only those two fields.
- `HostRunnerOptions.machine` is written into every presence beat.
- `RemoteHostDeps.resolveHostId?: (uid) => Promise<string>`: runs after sign-in / restore and
  before the old runner is torn down, so a rejection leaves the running one alone. Absent means
  the fixed `hostId` is used, exactly as today.

## Not changed

MulmoClaude passes neither, so its presence docs and channel are byte-identical.

## Release

Feature only. Publishing `@mulmoclaude/core` is a separate `chore(release)` via `/publish`.
MulmoTerminal then bumps to it.
