# fix(sandbox): the prompt may only name reference directories the agent can reach (#3194)

## Symptom

`buildReferenceDirsPrompt` listed every configured reference directory and told
the agent its container path was readable. `referenceDirMountArgs` skips some.
Both start from the same `getCachedReferenceDirs()` list and only the mount path
filtered it, so the two disagreed.

Measured, Docker mode, three entries:

```
mounts actually emitted : 1
told to the agent       : 3
  /mnt/readonly/refok-79a30073          ← real
  /mnt/readonly/ref_bad_x-a9753a15      ← never mounted
  /mnt/readonly/does-not-exist-cd5aaf3f ← never mounted
```

Two skip paths, one of them new:

| skip | since |
|---|---|
| `isExistingDirectory` false — configured, then deleted from disk | pre-existing |
| no docker flag can express the path | #3193 |

## Why it matters more than the `/api/sandbox` case

#3193's review caught the same class on `/api/sandbox` and fixed it. This surface
was checked by neither reviewer, and it is the worse of the two: `/api/sandbox`
misleads a **human**, who can go and look. The system prompt misleads the
**agent**, which acts on it — it opens an empty container path and can conclude
the user's reference material is empty. The feature fails quietly into looking
like it works.

## Approach

`planReferenceDirs(entries, useDocker, platform)` — one decision, returning
`{ args, available, skipped }`, used by both surfaces. This is the shape #3193's
review pushed `planConfigMounts` into; applying it here makes the two consistent
rather than inventing a second pattern.

Reachability is not the same question in the two modes, and the plan says so:

- **Docker** — reachable means a mount argument was produced.
- **No Docker** — there is no mount; the agent reads the host path directly, so
  existing on disk is the whole of it. A path Docker could not express is
  perfectly reachable here, and is still offered.

Pure apart from the existence check, and silent: the prompt is rebuilt every
turn, so the warning belongs to the spawn path alone. The log line now says
"not mounted, and not offered to the agent", because that is the fact an operator
needs — the old wording only mentioned the mount.

## Not doing

`server/api/routes/files.ts` resolves `@ref/<label>` on the HOST with
`realpathSync`, so the Files UI can still browse a directory the container never
received. That is not a false claim — the server really can read it — so it stays.
The asymmetry it leaves (Files UI sees it, the agent does not) is real and worth
knowing about, and is recorded in the issue rather than papered over here.

## Tests

`test/workspace/test_reference_dirs.ts`: under Docker an inexpressible path and a
deleted one are neither mounted nor offered; the arg count and the prompt line
count agree entry for entry; without Docker a colon-and-comma path IS offered
while a deleted one is not. Break-verified — four go red when the prompt is
restored to listing every entry.
