# fix: close the check-then-use race for file contents (#3573)

## Problem

Every containment check realpaths a path, checks it is inside the root, then uses the path
string. A component swapped to a symlink between the two syscalls is followed. Node `fs` has no
`openat` / `renameat` / `unlinkat`, so a descriptor-relative implementation is not available.

## What can be closed in portable Node, and how

Both operations first bind the root: `lstat` of the root realpath (bigint `dev` + `ino`) is taken
when the call begins and must still match at verification, so a root renamed away and replaced by
another directory mid-call is refused (Codex, PR #3580 round 1).

**Reads (read / readBytes): closed.** Open first, then prove the descriptor is the
in-root file:

1. realpath the candidate; outside or missing → missing
2. `open` it (`O_RDONLY`, plus `O_NOFOLLOW` / `O_NONBLOCK` where the platform has them)
3. realpath the candidate AGAIN; it must still be inside the root, and `lstat` of it must have the
   same `dev` + `ino` (bigint) as `fstat` of the handle
4. read from the handle only

A swap before the open and back before the re-check leaves a handle whose inode is not the
in-root file's, so step 3 fails. A swap after step 3 does not matter: the handle is already bound.

**Writes: closed under the threat model.** The staging file is created and verified, and the
rename stays inside the verified directory:

1. confine the parent as today (`resolveWriteWithinRoot`, which mkdirs it)
2. create `<leaf>.<random>.tmp` with `wx` (+ `O_NOFOLLOW`)
3. realpath the parent again (must be inside the root) and `lstat` the staging entry there: its
   inode must equal `fstat` of the handle — so the bytes are going into an in-root directory
4. write through the handle, close, rename staging → leaf within that verified directory

If the parent is swapped after step 3, the rename's source no longer resolves (the staging file
lives in the real directory) and it fails with ENOENT. Planting a file of the staging name in
the link's target needs write access to that target already.

## What stays best-effort (residual, documented)

- **readDir** — names of a swapped-in directory can leak (no content).
- **unlink** — no `unlinkat`; a parent swapped between the check and `unlink` deletes the
  same-named entry in the link's target.
- **stat / exists** — metadata and one bit, path-based as before: opening the file to verify
  would make an unreadable file throw EACCES where `stat` / `exists` answer today.
- **a stray empty staging file** — a write whose parent was swapped before the staging file was
  created fails, and can leave that empty `<leaf>.<random>.tmp` in the link's target.
- **a real directory moved in** — a directory renamed into the root (not linked) is inside the
  root from then on; moving one in from outside the workspace needs write access to it already.
- **hard links** — an in-root hard link to an outside file is the outside file; creating one needs
  access to that file already.

## Shape

- `packages/core/src/files/verified.ts`: `openVerifiedWithinRoot`, `writeFileVerifiedInDir`,
  exported from `@mulmoclaude/core/files`. Core gets a minor bump; ranges swept.
- `server/plugins/confined-file-ops.ts` uses them for read / readBytes / write.
- Other `resolveWithinRoot` call sites (files.ts, pdf.ts, /artifacts static, …) migrate in
  follow-up PRs, one per site group — each can be reverted on its own.

## Tests

- core `test/files/test_verified.ts`: races simulated at `beforeOpen` / `afterOpen` /
  `beforeRename` hooks (a parent swapped to an outside symlink, and back) → read is refused,
  write throws, the outside file is untouched
- server: existing confined-ops suites stay green
