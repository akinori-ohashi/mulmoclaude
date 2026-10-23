# fix: `lint_test (Windows)` red on `main` in `test_confinedFileOps.ts`

Two `makeConfinedFileOps` tests have failed on every Windows run of `main` since #3564 / #3580.

## Causes (from the Windows job log)

1. **"refuses parent traversal and absolute paths"** — `path.join(outside, "secret.json")` is `C:\…` on Windows.
   `normalizePluginPath` only refused `..` and a leading `/`, so `C:/…` passed the lexical step as a relative folder
   named `C:` and the read failed later as "not inside the scope". No escape (the path stayed under the scope), but the
   contract says absolute paths are refused. **Fix:** a leading drive letter is refused like `/`; the test gains
   `C:\…` and `c:…` cases that run on every platform.
2. **"propagates an error other than ENOENT"** — the test opens a path through a regular file to get `ENOTDIR`.
   Windows reports that path as ENOENT, so there is no non-ENOENT error for the input to produce. **Fix:** the test is
   skipped on Windows; it still runs on Linux and macOS.

## Verified

- Removing the drive-letter check turns the new assertions red on macOS.
- Windows itself is verified by CI (`lint_test (Windows)`).
