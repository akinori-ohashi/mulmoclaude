// Type declarations for preflight.mjs.

export interface NodeVersion {
  major: number;
  minor: number;
  patch: number;
}

export const REQUIRED_NODE: readonly NodeVersion[];

export function parseNodeVersion(raw: string): NodeVersion | null;

export function isNodeVersionSupported(raw: string, required?: readonly NodeVersion[]): boolean;

export function formatRequiredNode(required?: readonly NodeVersion[]): string;

export function formatEnginesRange(required?: readonly NodeVersion[]): string;

export interface CommandProbeOptions {
  env?: Record<string, string | undefined>;
  run?: (file: string, args: string[], options: object) => unknown;
}

export function isCommandAvailable(command: string, deps?: CommandProbeOptions): boolean;

export interface PreflightFailure {
  key: "nodeTooOld" | "npxMissing" | "claudeMissing";
  values: Record<string, string>;
}

export interface PreflightOptions {
  nodeVersion?: string;
  env?: Record<string, string | undefined>;
  commandAvailable?: (command: string) => boolean;
}

export function runPreflight(deps?: PreflightOptions): PreflightFailure | null;
