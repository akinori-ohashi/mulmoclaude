# fix: stop spending Claude sessions on credential renewals that cannot succeed (#3309, part 1 of 3)

## Problem

On macOS + Docker sandbox, `refreshCredentials()` (`server/system/credentials.ts`) launches the
`claude` CLI through a PTY to renew an expired OAuth token. Each launch is a real, billed Claude
session. When the Keychain blob can never become valid (empty `accessToken`, `expiresAt: 0`),
every renewal fails, and nothing caps the attempts:

- startup: `ensureCredentialsAvailable()` → `process.exit(1)` → `scripts/dev-server.mjs` restarts
  after 300 ms, and a ~33 s cycle is judged "ran long enough", so the fast-crash cap never fires.
- per turn: `prepareAgentRun()` calls `refreshCredentials()` on every turn.

Traced from the entry points: `yarn dev` → `dev-server.mjs` → `server/index.ts`
`ensureCredentialsAvailable` (only when `~/.claude/.credentials.json` is missing, which stays true
because a failed refresh never writes it) → `refreshCredentials` → `isTokenExpired` (`expiresAt: 0`
passes `Number.isFinite`) → `renewTokenViaPty`.

## Split

1. **This PR** — never spend a session on a renewal that cannot succeed.
2. Keychain lookup picks the right item when several share the service name.
3. Language-independent PTY response detection + dev-server handling of slow crash loops.

## Approach (this PR)

- New pure module `server/system/credentialsState.ts`:
  - `classifyCredentials(raw, nowMs)` → `valid` / `expired` / `unusable(reason)`.
    `unusable` when: unparseable / no `claudeAiOauth`, empty `accessToken`, no usable expiry or
    expiry `<= 0`, or expired with an empty `refreshToken`. Renewal is only attempted for
    `expired`. (A null expiry already could never pass the post-renewal re-check, so treating it as
    unusable removes only the wasted session.)
  - `renewalDecision(history, nowMs)` / `recordRenewal(history, succeeded, nowMs)`: cooldown after
    each failure, give up after a small number of consecutive failures; success resets. A valid
    token seen in the Keychain (the user re-logged in) also resets.
  - `readExpiresAt` moves here (pure).
- `credentials.ts` keeps the I/O and holds the in-process history.
- Startup: `ensureCredentialsAvailable()` exits with a dedicated code from a shared
  `server/utils/exit-codes.mjs`; `dev-server.mjs`'s `restartPlan` gives up on that code instead of
  restarting. A test pins that both sides read the same constant.
- `packages/core/assets/helps/error-recovery.md`: note that MulmoClaude stops renewing and what the
  user does; bump `@mulmoclaude/core` and sweep ranges.

## Out of scope

Keychain `-a` selection, response-detection language, dev-server slow-crash detection (parts 2, 3).
