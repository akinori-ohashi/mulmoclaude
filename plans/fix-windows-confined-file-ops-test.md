# fix: `lint_test (Windows)` red on `main` in `test_confinedFileOps.ts`

Two `makeConfinedFileOps` tests have failed on every Windows run of `main` since #3564 / #3580.

## Causes (from the Windows job log)

1. **"refuses parent traversal and absolute paths"** — `path.join(outside, "secret.json")` is `C:\…` on Windows.
   `normalizePluginPath` only refused `..` and a leading `/`, so `C:/…` passed the lexical step as a relative folder
   named `C:` and the read failed later as "not inside the scope". No escape (the path stayed under the scope), but the
   contract says absolute paths are refused. **Fix:** a leading drive letter is refused like `/`; the test gains
   `C:\…` and `c:…` cases that run on every platform.
2. **"propagates an error other than ENOENT"** — the test opens a path through a regular file to get `ENOTDIR`.
   Windows reports that path as ENOENT, so there is no non-ENOENT error for the input to produce. **Fix:** the traversal
   cases are skipped on Windows (they still run on Linux and macOS); listing a regular file is its own test, which
   runs on every platform.

3. **`packages/core/test/files/test_verified.ts`**, which `main` never reached on Windows because the host suite
   failed first. The test built its anchor with `realpathSync`, which keeps Windows 8.3 names (`RUNNER~1`), while the
   code re-resolves with async `realpath` (long names), so an in-scope file read as outside. Production builds every
   anchor with async `realpath`, so only the test was wrong. **Fix:** `realpathSync.native`.
   Its "parent swapped out after the open" case renames a directory that holds an open file, which Windows refuses
   (EPERM), so that swap cannot happen there; the case is skipped on Windows.

## Verified

- Removing the drive-letter check turns the new assertions red on macOS.
- Windows itself is verified by CI (`lint_test (Windows)`).
