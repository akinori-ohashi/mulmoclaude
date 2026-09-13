// Type declarations for devArgs.mjs.

export interface DevFlag {
  flag: string;
  env: string;
}

export type DevArgs = { ok: true; variant: string; env: Record<string, "1"> } | { ok: false; reason: string };

export function parseDevArgs(argv: readonly string[], flags: readonly DevFlag[]): DevArgs;
