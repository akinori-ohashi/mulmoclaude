# fix: read the right Keychain item when several share the service name (#3309, part 2 of 3)

## Problem

`readFromKeychain()` runs `security find-generic-password -s "Claude Code-credentials" -w` with no
account. With two items under that service (in #3309: the real login under the user's name and an
empty one under `unknown`, created by a Claude Code reinstall), `security` returns one of them and
MulmoClaude may read the empty one while Claude Code itself uses the real one. Part 1 (#3319) stops
this from spending sessions; the credentials still cannot be exported.

Observed on this machine: Claude Code's own item has `acct` = the OS user name.

## Approach

- Read two candidates: `-a <os user name> -s … -w` (Claude Code's own item) and the service-only
  lookup (what was read before, covering installs that store another account name).
- New pure `pickCredentials(candidates, nowMs)` in `credentialsState.ts`: the best by
  `classifyCredentials` — valid, then expired, then unusable; ties keep the earlier candidate
  (account-specific first). All candidates missing → null.
- `yarn sandbox:login` tries `-a "$USER"` first and falls back to the service-only lookup.
- `error-recovery.md`: the "looks the item up by service name only" sentence becomes false; say what
  is read now and when a stray item can still matter. `sandbox.md`: `sandbox:login` exports the
  Keychain item; it does not open a login. Core stays at the unpublished 5.6.1.

## Out of scope

Response detection language and dev-server slow crash loops (part 3).
