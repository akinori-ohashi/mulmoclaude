// Where a missing `GEMINI_API_KEY` actually belongs, for this launch.
//
// The advice used to be written as prose — "the directory you launch
// MulmoClaude from, or export it before starting" — and both halves are
// wrong from a desktop icon: there is no launch directory (the server is
// started from home since #2621), and the icon launcher harvests PATH
// from the login shell and nothing else, so an `export` never arrives
// (#2626). The people that guidance failed are precisely the ones who
// never open a terminal.
//
// So nothing here describes a route. The launcher hands over the `.env`
// it consulted and says whether this was an icon, and the message names
// that path. Pure, apart from `currentLaunchRouteFacts`, so the log line,
// the `/api/health` payload and the Settings tab all read one answer.

import path from "node:path";
import { hasControlCharacter } from "../utils/text.js";
import { env } from "./env.js";

export interface LaunchRouteFacts {
  /** Absolute path of the `.env` this process reads a key from. */
  envFilePath: string;
  /** Whether a shell `export` can reach this process at all. */
  shellExportReaches: boolean;
}

/** A path we are willing to typeset into a log line and the UI. The value
 *  arrives through `process.env`, which anything on the box can set, so
 *  "absolute, single line" is enforced here rather than assumed of the
 *  producer — the same rule `shadowedEnv.ts` applies to key names. */
function isRenderablePath(value: string): boolean {
  return path.isAbsolute(value) && !hasControlCharacter(value);
}

/** The `.env` a key belongs in, and whether the shell is an option.
 *
 *  `launchEnvPath` absent means nothing launched us — a direct
 *  `tsx server/index.ts` or `yarn dev` — and there the server's own load
 *  reads `<cwd>/.env` (`loadEnv.ts`), so the cwd is the honest answer. */
export function launchRouteFacts(options: { launchEnvPath?: string | undefined; launchedFromIcon: boolean; cwd: string }): LaunchRouteFacts {
  const handed = options.launchEnvPath?.trim();
  return {
    envFilePath: handed && isRenderablePath(handed) ? handed : path.join(options.cwd, ".env"),
    shellExportReaches: !options.launchedFromIcon,
  };
}

/** The facts for the running process. */
export function currentLaunchRouteFacts(): LaunchRouteFacts {
  return launchRouteFacts({ launchEnvPath: env.launchEnvPath, launchedFromIcon: env.launchedFromIcon, cwd: process.cwd() });
}

/** Kept verbatim because `packages/core/assets/helps/gemini.md` tells the
 *  user to look for it in the log. */
export const GEMINI_KEY_MISSING_HEADLINE = "GEMINI_API_KEY not set — image / audio / video generation is unavailable.";

export function geminiKeyMissingMessage(facts: LaunchRouteFacts): string {
  const where = facts.shellExportReaches
    ? `Put it in ${facts.envFilePath}, or export GEMINI_API_KEY before starting.`
    : `Put it in ${facts.envFilePath} — an icon launch has no launch directory, and a shell export never reaches it.`;
  return `${GEMINI_KEY_MISSING_HEADLINE} ${where}`;
}
