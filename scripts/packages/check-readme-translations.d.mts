// Type declarations for check-readme-translations.mjs. Sidecar so the script
// stays plain JS (runnable with `node` on a fresh clone) while tests get a typed
// import surface — same arrangement as scripts/packages/audit-releases.d.mts.

/** One file inside a packed tarball, as `npm pack --json` describes it. */
export interface PackedFile {
  path: string;
}

/** One packed package out of `npm pack --json`. */
export interface PackEntry {
  name?: string;
  files: PackedFile[];
}

/** Matches a README translation (`README.ja.md`, `README.pt-BR.md`). The
 *  canonical `README.md` is deliberately NOT a match — it ships by default. */
export const TRANSLATION_RE: RegExp;

/** The single packed package, whichever shape npm used: an array (npm <= 11) or
 *  an object keyed by package name (npm 12). Null when the value is neither —
 *  which the caller must treat as "cannot verify", never as "no files". */
export function packEntry(parsed: unknown): PackEntry | null;

/** One package's audit result. `error` set = the tarball could never be read,
 *  which is a gate failure in its own right, not a pass. */
export interface AuditResult {
  name: string;
  onDiskTranslations: string[];
  missing: string[];
  skipped?: string;
  error?: string;
}

/** The roster line for one result: `OK`, `skipped (…)`, `MISSING: …`, `ERROR: …`. */
export function statusLine(result: AuditResult): string;

/** The two distinct reasons the gate fails: translations absent from a tarball
 *  that WAS read, and packages whose tarball could not be read at all. */
export function classify(results: AuditResult[]): { missing: AuditResult[]; unverified: AuditResult[] };
