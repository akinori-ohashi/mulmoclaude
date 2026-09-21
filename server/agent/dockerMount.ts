// Turning a host path into a Docker bind-mount argument without corrupting it
// (#3191).
//
// Two rules live here, and both were measured against the daemon rather than
// reasoned about:
//
//  1. The separator conversion is a WINDOWS rule. Docker wants `/` and a Windows
//     host path spells them `\`. On POSIX a backslash is an ordinary filename
//     character, and converting it there hands Docker a path that does not
//     exist — which it answers by creating an empty directory and mounting that,
//     silently.
//
//  2. `-v` and `--mount` are COMPLEMENTARY, not one-better-than-the-other:
//
//       character | -v      | --mount
//       ----------|---------|--------
//       "         | works   | fails (its CSV reader rejects a bare quote)
//       ,         | works   | fails (field separator)
//       :         | fails   | works
//
//     So neither flag can carry every path, and switching everything to
//     `--mount` would fix colons while breaking commas. `-v` stays the default —
//     every path that works today keeps taking it — and `--mount` is the
//     fallback for the one thing it cannot express.
//
// Pure on purpose: no fs, no env, no platform sniffing. The platform is an
// argument so the Windows rule is assertable from a POSIX runner.

import type { Platform } from "./config.js";

const WINDOWS_PLATFORM = "win32";
const BACKSLASH = "\\";

/** `-v` splits its fields on this, so a path holding one cannot use it. */
const V_FLAG_SEPARATOR = ":";

/** `--mount` parses one CSV record: `,` ends the field and a bare `"` puts the
 *  reader into a quoted-field state it then rejects. */
const MOUNT_FLAG_BREAKERS = new Set([",", '"']);

/** Lowest code point the `--mount` reader can carry: below this are control
 *  characters, and a newline among them ends the record outright. */
const MIN_PRINTABLE_CODE_POINT = 0x20;

export interface DockerMountSpec {
  /** Absolute path on the host, spelled the way the host spells it. */
  hostPath: string;
  /** Absolute path inside the container. */
  containerPath: string;
  readOnly: boolean;
}

export type DockerMountArgs =
  | { kind: "args"; args: string[] }
  | {
      /** Neither flag can express this path. The caller decides whether that
       *  costs the mount (skip) or the container (refuse). */
      kind: "inexpressible";
      reason: string;
    };

/** Docker wants `/`; a Windows host path spells them `\`. Split rather than
 *  replace so the rule is visibly per-platform, and leave POSIX alone — a
 *  backslash there is part of the filename. */
export function toDockerSource(hostPath: string, platform: Platform): string {
  return platform === WINDOWS_PLATFORM ? hostPath.split(BACKSLASH).join("/") : hostPath;
}

// On Windows every absolute path opens with a drive letter — `C:\Users\…` — and
// Docker understands that colon in a `-v` source. Without this, EVERY Windows
// mount would look unusable with `-v` and get pushed onto `--mount`, which is
// the broad behaviour change this fix exists to avoid.
function withoutDriveLetter(field: string, platform: Platform): string {
  return platform === WINDOWS_PLATFORM && /^[A-Za-z]:/.test(field) ? field.slice(2) : field;
}

function usableWithVFlag(source: string, target: string, platform: Platform): boolean {
  return !withoutDriveLetter(source, platform).includes(V_FLAG_SEPARATOR) && !target.includes(V_FLAG_SEPARATOR);
}

function usableWithMountFlag(...fields: readonly string[]): boolean {
  return fields.every((field) =>
    [...field].every((character) => !MOUNT_FLAG_BREAKERS.has(character) && (character.codePointAt(0) ?? 0) >= MIN_PRINTABLE_CODE_POINT),
  );
}

/**
 * The docker argv fragment that bind-mounts `hostPath` at `containerPath`, or
 * an `inexpressible` result naming why no flag can carry it.
 *
 * `-v` is preferred so that every path working today keeps the argument it
 * already gets; `--mount` is used only when a colon rules `-v` out.
 */
export function dockerMountArgs(spec: DockerMountSpec, platform: Platform): DockerMountArgs {
  const source = toDockerSource(spec.hostPath, platform);
  const target = spec.containerPath;

  if (usableWithVFlag(source, target, platform)) {
    const mode = spec.readOnly ? ":ro" : "";
    return { kind: "args", args: ["-v", `${source}:${target}${mode}`] };
  }
  if (usableWithMountFlag(source, target)) {
    const readonly = spec.readOnly ? ",readonly" : "";
    return { kind: "args", args: ["--mount", `type=bind,source=${source},target=${target}${readonly}`] };
  }
  return {
    kind: "inexpressible",
    reason: `path holds both ":" (which -v splits on) and a character --mount cannot carry (a comma, a double quote, or a control character)`,
  };
}

/** Thrown for a mount the sandbox cannot run without. Carries the path so the
 *  message names what the user has to rename, rather than leaving them with
 *  Docker's own wording about a spec they never wrote. */
export class UnmountablePathError extends Error {
  constructor(
    readonly hostPath: string,
    reason: string,
  ) {
    super(`Cannot mount ${hostPath} into the sandbox: ${reason}. Rename it, or point the sandbox at a different path.`);
    this.name = "UnmountablePathError";
  }
}

/** For a mount the sandbox cannot start without: arguments, or a throw naming
 *  the path. */
export function requiredMountArgs(spec: DockerMountSpec, platform: Platform): string[] {
  const result = dockerMountArgs(spec, platform);
  if (result.kind === "inexpressible") throw new UnmountablePathError(spec.hostPath, result.reason);
  return result.args;
}
