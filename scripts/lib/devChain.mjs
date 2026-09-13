// The commands each `yarn dev` variant runs, in order (#3113).
//
// These lived in package.json as compound `a && b && c` strings until the flags
// they were supposed to accept turned out to be silently dropped — yarn hands a
// script's trailing args to the LAST command only. `scripts/dev.mjs` runs them
// instead, which is what lets the flags become env before step one.
//
// They are a separate module from the launcher so that a test can read the real
// strings rather than grep the launcher's source, and without importing an entry
// point that would start a dev server on import.
//
// Plain `.mjs`: `yarn dev` runs under bare node, with no tsx.

/** `yarn dev`'s client pane. `MULMOCLAUDE_DEV_FOLLOW_PORT=1` is what opts Vite
 *  into following `<workspace>/.server-port` instead of trusting `PORT` (#2995);
 *  `yarn dev:client` deliberately does NOT set it, having no backend of its own. */
const CLIENT_PANE = "yarn wait:backend && cross-env MULMOCLAUDE_DEV_FOLLOW_PORT=1 vite";

/** `cross-env` and `npm run` are kept from what package.json held, so this stays a
 *  change of entry point rather than a rewrite of what actually runs. */
const bothPanes = (serverScript) => `concurrently -n server,client -k "cross-env FORCE_COLOR=1 npm run ${serverScript}" "${CLIENT_PANE}"`;

/** Clearing `.server-port` before either pane starts is what makes the client's
 *  "is this publish mine?" question answerable at all (#2981). */
const RESET = "yarn wait:backend --reset";

/** @type {Readonly<Record<string, readonly string[]>>} */
export const VARIANTS = Object.freeze({
  dev: Object.freeze(["node scripts/dev-build-if-needed.mjs", RESET, bothPanes("server")]),
  debug: Object.freeze(["node scripts/dev-build-if-needed.mjs", RESET, bothPanes("server:debug")]),
  "full-build": Object.freeze(["yarn build:packages:dev", RESET, bothPanes("server")]),
});
