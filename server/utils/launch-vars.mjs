// Names of the env vars the launcher chain uses to tell the server HOW it
// was started. Three processes have to agree on them — the icon launcher
// (`launcher/start.mjs`), the CLI (`packages/mulmoclaude/bin/
// mulmoclaude.js`) and the server (`server/system/env.ts`) — and only the
// first two run before tsx exists, so this is plain `.mjs` with a sibling
// `.d.mts`, like port.mjs / cli-flags.mjs.
//
// Dependency-free on purpose: the icon launcher imports this on its
// critical path, before `npx` has installed anything.

/** Absolute path of the `.env` the CLI consulted, set whether or not the
 *  file was there. The server names it when telling the user where a key
 *  belongs: an icon launch has no launch directory to refer to, so the
 *  only honest answer is the path itself (#2626). */
export const LAUNCH_ENV_PATH_VAR = "MULMOCLAUDE_LAUNCH_ENV_PATH";

/** How the chain was started. Absent for a terminal launch. */
export const LAUNCHED_FROM_VAR = "MULMOCLAUDE_LAUNCHED_FROM";

/** Value of `LAUNCHED_FROM_VAR` for a desktop-icon launch. The launcher
 *  harvests PATH from the login shell and nothing else, so a shell
 *  `export` never reaches a server started this way — guidance that
 *  offers it is wrong for exactly the users who never open a terminal. */
export const LAUNCHED_FROM_ICON = "icon";
