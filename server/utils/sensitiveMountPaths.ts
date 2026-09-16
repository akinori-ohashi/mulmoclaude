// Host paths that must never be bind-mounted into the sandbox.
//
// This started as private constants inside `reference-dirs.ts`, where the only
// user-chosen mount was a reference directory. Plugin trees registered with
// `claude plugin marketplace add <local path>` are a second one (#3198), and two
// copies of a security blocklist is how they drift — the second one acquires the
// entry the first one already has, six months late.
//
// `home` and `platform` are parameters so a test can exercise the Windows rule
// from a POSIX runner and the `$HOME` rule without depending on the developer's
// own home directory.

import path from "node:path";
import { homedir } from "node:os";

/** Home-relative directories that must never be mounted. */
const HOME_RELATIVE_BLOCKED = [".ssh", ".aws", ".gnupg", ".config/gh", ".kube", ".docker"];

/** Absolute system paths that must never be mounted, POSIX spelling. */
const POSIX_SYSTEM_BLOCKED = ["/etc", "/root", "/var", "/proc", "/sys", "/boot", "/private/etc", "/private/var", "/System", "/Library"];

/** The Windows equivalents, read from the environment rather than hardcoded:
 *  the system drive is not always `C:`, and a hardcoded letter would silently
 *  block nothing on a machine that boots from another one. Entries the OS
 *  doesn't set are simply absent. */
function windowsSystemBlocked(): string[] {
  const candidates = [process.env.SystemRoot, process.env.windir, process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.ProgramData];
  return candidates.filter((value): value is string => typeof value === "string" && value.length > 0).map((value) => path.win32.resolve(value));
}

/** The platform's rules, resolved once.
 *
 *  `paths` is `path.win32` or `path.posix` rather than the ambient `path`,
 *  because `resolve` / `join` / `sep` are all host-bound: with the ambient one a
 *  `platform: "win32"` argument changes the case folding and nothing else, so
 *  the Windows rule could not be asserted from a POSIX runner at all — which is
 *  the discipline `toPosixRelPath` established here, for the same reason.
 *
 *  Windows filesystems are case-insensitive, so `c:\windows` and `C:\Windows`
 *  name one directory and comparing them verbatim would let the lowercase
 *  spelling walk past the blocklist. The POSIX system list is dead weight on
 *  Windows — `win32.resolve("/etc")` yields `<drive>:\etc`, which matches no
 *  entry — so each platform carries only its own vocabulary. */
function comparisonRules(platform: typeof process.platform): { paths: typeof path.posix; key: (value: string) => string; systemBlocked: string[] } {
  return platform === "win32"
    ? { paths: path.win32, key: (value) => value.toLowerCase(), systemBlocked: windowsSystemBlocked() }
    : { paths: path.posix, key: (value) => value, systemBlocked: POSIX_SYSTEM_BLOCKED };
}

export interface SensitivePathOptions {
  /** Defaults to the real home. Injected by tests. */
  home?: string | undefined;
  /** Defaults to the host platform. Injected by tests. */
  platform?: typeof process.platform | undefined;
  /** Test seam, and the reason it exists is worth stating: on macOS
   *  `os.tmpdir()` resolves under `/var`, which this list blocks — correctly, but
   *  it means a test cannot build a fixture in a temp directory and have it
   *  accepted. Without a seam the only way out is to write under `$HOME`, which
   *  is what stops a sandboxed reviewer running such a file at all (#3196).
   *  Production passes nothing and gets the real list. */
  systemBlocked?: readonly string[] | undefined;
}

/**
 * Whether bind-mounting `absPath` into the sandbox would expose something it
 * must never see: the filesystem root, `$HOME` itself (which transitively
 * carries `.ssh` and the rest), a known credential directory, or a system
 * directory.
 */
export function isSensitiveMountPath(absPath: string, options: SensitivePathOptions = {}): boolean {
  const { paths, key, systemBlocked: defaultBlocked } = comparisonRules(options.platform ?? process.platform);
  const systemBlocked = options.systemBlocked ?? defaultBlocked;
  const home = options.home ?? homedir();
  const normalized = paths.resolve(absPath);
  const target = key(normalized);

  // The trailing separator is what keeps `/etc-backup` out of `/etc`'s subtree.
  const isAtOrUnder = (blockedDir: string): boolean => target === key(blockedDir) || target.startsWith(key(blockedDir) + paths.sep);

  if (normalized === paths.parse(normalized).root) return true;
  if (target === key(home)) return true;
  if (HOME_RELATIVE_BLOCKED.some((blocked) => isAtOrUnder(paths.join(home, blocked)))) return true;
  return systemBlocked.some((blocked) => isAtOrUnder(blocked));
}
