# fix(security): resolve a reference directory before trusting it (#3200)

## Symptom

A reference directory named `~/notes` whose real target is `~/.ssh` is mounted
into the sandbox read-only, offered to the agent by name in the system prompt,
and served file by file through `@ref/notes/…`. The blocklist that exists to
stop exactly this never sees the target.

Filed while fixing #3198, which had the identical defect in plugin trees.

## Root cause — one rule applied to the wrong string

`isSensitiveMountPath` is **lexical by contract**: it never touches the
filesystem, so it answers about the path's _spelling_. Everything that consumes
a reference directory _follows the symlink_:

| consumer                            | what it does with the entry                                   |
| ----------------------------------- | ------------------------------------------------------------- |
| `planReferenceDirs` → docker argv   | binds `entry.hostPath`; Docker resolves the source itself     |
| `planReferenceDirs` → system prompt | names the host path to the agent, whose reads follow the link |
| `resolveRefPath` (file API)         | `realpathSync` then serves content under it                   |
| `ref-roots` listing                 | lists it in the explorer                                      |

So the check ran on `~/notes` and the use ran on `~/.ssh`.

Measured against the daemon rather than argued — the pre-fix argv, verbatim:

```
$ docker run --rm -v "…/innocent-notes:/mnt/readonly/innocent-notes-c300999e:ro" alpine \
    sh -c 'ls /mnt/readonly/innocent-notes-c300999e/ && cat …/config'
config
TOP-SECRET-REF-KEY
```

## Approach

`resolveReferenceDir(hostPath, options?)` answers `ok` / `missing` / `blocked`,
and every consumer routes through it. `blocked` carries the **real** path,
because the entry's own spelling is the innocent-looking half and a log naming
only that would say nothing.

Three decisions worth stating, because each could reasonably have gone the other
way:

1. **The entry keeps the user's spelling; resolution happens at every use.**
   Storing the target would freeze it — an entry could no longer follow a
   symlink the user repoints deliberately — and it would rewrite a config the
   user hand-wrote. Resolving per use also means a symlink repointed _after_
   the entry was saved is re-checked, which storing cannot do. The container
   path stays hashed from the spelling, so the agent keeps reading the same
   place across a deliberate repoint.
2. **The check runs BEFORE the Docker branch, not inside it.** Without Docker
   there is no mount to get wrong and the hole is exactly the same size: the
   prompt hands the agent that host path and the agent's reads follow the link.
3. **`validateEntry` does NOT require the path to resolve.** It rejects one that
   resolves somewhere blocked, so the API says no at save time — but an absent
   directory (external drive, network share) stays configurable, and
   `planReferenceDirs` already skips it per turn. Requiring resolution would
   turn "not plugged in today" into "cannot be configured".

`skipped.kind` gains `blocked`, logged at `warn`: it is the shape a symlink
escape takes and must not read as the routine `missing`.

## Not fixed here

The window between `planReferenceDirs` resolving and Docker binding is not
closed — a same-user process can repoint the link in between. Closing it needs
the kernel to bind the resolved inode rather than a path, which Docker does not
offer. It is strictly narrower than before, when nothing checked the target at
any point.

## What the issue got wrong

I wrote there that the fix "moves the entry's label, the container-path hash,
the dedup key and the prompt/UI/`/api/sandbox` agreement". Measured while doing
it: none of that moved. The label and hash still derive from the entry's own
spelling, dedup is on the label, and `/api/sandbox` does not report reference
directories at all — the surfaces are the prompt, the mount args and the two
file-API sites, and the first two already share one decision point from #3194.

## Tests

`test/workspace/test_reference_dirs.ts` — the three verdicts; the tree not
mounted and not offered, with and without Docker; the bind source being the
resolved path; the container path surviving a repoint; `blocked` kept distinct
from `missing`; save-time rejection; and an absent path still validating.

Fixtures use the injected blocklist so they live in a temp directory (#3196).
Three pre-existing plan tests needed the same seam once the plan started
resolving — on macOS a temp directory resolves under `/private/var`, which the
real list blocks, so they were failing for the one reason they are not about.

### The harness could not be run by a sandboxed reviewer, and this PR made it worse

Found by the review loop's own pre-flight, before round 1: the suite exits 1 for
a reviewer with no `$HOME` write access, because `realDir` used
`mkdtemp` under `$HOME` — and the symlink fixture this PR ADDED did the same,
taking it from three unrunnable tests to four.

```
Error: EPERM: operation not permitted, mkdtemp '/Users/…/.mulmoclaude-test-ref-XXXXXX'
ℹ tests 31   ℹ pass 26   ℹ fail 4
```

`makeUnblockedTempDir` now owns that choice in one place: `/tmp` on macOS, which
resolves to `/private/tmp` and is NOT on the blocklist, against `os.tmpdir()`'s
`/var/folders/…` which is; and `os.tmpdir()` everywhere else, where it already
works. Nothing in `test/` or `e2e/` creates anything under `$HOME` any more.

This is #3196, which had been closed _by accident_ — #3199's body said "This
does not close #3196" and GitHub's parser matched the substring `close #3196`,
ignoring the negation. It was marked complete while still broken. It is true now.

### Three assertions passed for the wrong reason, so the rule is inverted

The same shape three times, which is the signal to stop patching cases:

1. The save-time case put its symlink in a temp directory, which the lexical
   check already rejects for being under `/var` — green with the new check
   deleted.
2. The whole suite was unrunnable for a sandboxed reviewer (above).
3. The non-Docker prompt assertion dropped the injected options, so it fell back
   to the real blocklist and passed on macOS for the `/var` reason — and **failed
   on Linux**, where `/tmp` is allowed. Raised by Codex; reproduced by pointing
   the fixture at an unblocked directory, which turns it red here too.

So the fixture now enforces both properties instead of each call site
remembering them. It sits somewhere the REAL blocklist ALLOWS and asserts that
before anything else — so a call that forgets the seam OFFERS the entry and goes
red — and it returns `plan` / `prompt` pre-bound so the seam cannot be dropped.
Putting the fixture back in a blocked temp directory now fails six tests at the
precondition rather than passing all of them silently.

## Verification

Through `referenceDirMountArgs` and `buildReferenceDirsPrompt`, the argv the
spawn path actually builds: a reference directory pointing at the real `~/.ssh`
produces no mount and no prompt line, with a warning naming the resolved target,
while an ordinary directory beside it still mounts and is still offered.

Break-verified by mutation, restoring from a pristine copy between cases:
checking the spelling instead of the target, binding the alias, collapsing
`blocked` into `missing`, moving the check after the Docker branch, and dropping
the save-time check each turn tests red.
