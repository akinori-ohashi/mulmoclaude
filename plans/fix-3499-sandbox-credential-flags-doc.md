# fix: error-recovery.md documents sandbox credential CLI flags that do not exist (#3499)

## Problem

`packages/core/assets/helps/error-recovery.md` ("gh / git / SSH errors inside the sandbox") said:

> Equivalent CLI flags: `--sandbox-forward-ssh-agent --sandbox-mount-configs=gh`.

Neither flag exists. `server/utils/cli-flags.mjs` registers boolean toggles only, and
`server/system/env.ts` reads `SANDBOX_SSH_AGENT_FORWARD` / `SANDBOX_MOUNT_CONFIGS` from the
environment alone. Through `npx mulmoclaude` the flags are silently ignored, so a Windows user
(no `VAR=value cmd` in PowerShell) who followed the doc got no mounts and no log line.

The bash sample in the same section was also broken: a comment line inside the `\` continuation
ends the command early, so `SANDBOX_SSH_AGENT_FORWARD=1` became an unexported shell variable and
never reached `yarn dev`.

## Fix (docs only)

- Drop the "Equivalent CLI flags" line and say these two are env-only.
- Put the bash sample on one line with the comments above it.
- Add the PowerShell form (`$env:...` in the same session, then `npx mulmoclaude`).
- Note that SSH forwarding is skipped when `$SSH_AUTH_SOCK` is not an existing socket, naming the
  log line the user will see.

## Out of scope

Implementing `--sandbox-mount-configs=<csv>` / `--sandbox-forward-ssh-agent` as real flags. It
needs a value-bearing flag outside the boolean registry (launcher, `scripts/lib/devArgs.mjs`,
`server/system/env.ts`) and can be a separate issue if wanted.
