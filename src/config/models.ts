// The model and reasoning-effort vocabularies the `claude` CLI accepts,
// in the one place both the server and the browser read them from.
//
// They used to be declared twice — once in `server/system/config.ts` for the
// validator and the `--model` / `--effort` flags, once inside
// `SettingsModelTab.vue` for the `<option>` lists. Nothing tied the copies
// together, and the failure was silent in both directions: a value added
// server-side never appeared in the picker, and one added in the picker was
// rejected with a 400 by a validator that had never heard of it. Lint,
// typecheck and the suite all stayed green either way.
//
// This file lives under `src/config/` because that is already where constants
// shared across the boundary live (`apiRoutes`, `toolNames`, `roles`,
// `pubsubChannels`, `firebaseConfig` are all imported from `server/`).

/** Model families accepted by `claude --model`. Aliases only, never a pinned
 *  id like `claude-opus-4-8`: an alias follows the user's saved choice onto
 *  the next generation, while a pinned id silently keeps them on a model that
 *  is eventually retired (#2923). */
export const CHAT_MODELS = ["fable", "opus", "sonnet", "haiku"] as const;
export type ChatModel = (typeof CHAT_MODELS)[number];

/** Reasoning-effort levels accepted by `claude --effort` (#1323). A closed
 *  union so the validator and the picker stay in lockstep; a level the CLI
 *  adds must be mirrored here intentionally. */
export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];
