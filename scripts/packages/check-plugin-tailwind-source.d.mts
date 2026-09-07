// Type declarations for check-plugin-tailwind-source.mjs. Sidecar so the script
// stays plain JS (runnable with `node` on a fresh clone) while tests get a typed
// import surface — same arrangement as scripts/docs/check-doc-links.d.mts.

/** A core source file that declares Tailwind classes, as the rule reads it. */
export interface CoreClassFile {
  /** Absolute path. */
  file: string;
  /** Every coloured Tailwind class the file names. */
  classes: Set<string>;
  /** Every symbol the file exports by name. */
  exports: string[];
  /** Whether the file has a default export — a use this rule cannot follow. */
  hasDefaultExport: boolean;
}

/** A plugin package's Tailwind entry, as the rule reads it. */
export interface PluginCssEntry {
  name: string;
  /** Absolute path to the package's `src/style.css`. */
  cssPath: string;
  /** Every `@source` target, resolved against the CSS file. */
  targets: string[];
  /** The core exports this plugin's own sources mention. */
  usedExports: string[];
}

/** A plugin rendering classes its own build never scans. */
export interface TailwindSourceGap {
  plugin: string;
  cssPath: string;
  coreFile: string;
  symbols: string[];
  classes: number;
}

/** Every coloured Tailwind class named in `source` (variants kept: `hover:bg-x-100`). */
export function colorClassesIn(source: string): Set<string>;

/** Every symbol `source` exports by name. */
export function exportedNamesIn(source: string): string[];

/** `css` with every comment blanked to spaces (length preserved), so a
 *  commented-out directive is never read as live. */
export function withoutComments(css: string): string;

/** Every path a CSS file hands to a LIVE `@source`, in the order they appear. */
export function sourceTargetsIn(css: string): string[];

/** Whether a resolved `@source` target covers `file` — the file itself, or a
 *  directory above it. */
export function sourceCovers(target: string, file: string): boolean;

/** Whether `source` has a default export. */
export function hasDefaultExport(source: string): boolean;

/** Class-carrying core files whose use cannot be detected: a default import
 *  arrives under a name of the plugin's choosing. */
export function undetectableCoreFiles(coreFiles: CoreClassFile[]): CoreClassFile[];

/** Which core files a plugin renders classes from but never scans. */
export function findGaps(coreFiles: CoreClassFile[], plugins: PluginCssEntry[]): TailwindSourceGap[];
