// Which model a session runs on, and — just as importantly — why.
//
// The "why" is not decoration. #2923 existed because the model changed and
// nothing on screen said so; every further place a model can come from
// recreates that invisibility unless the answer says which place won. There are
// now four, so this returns the source alongside the value and the UI states it.
//
// `shared` is the case the whole feature is about: nothing here decided, so
// MulmoClaude passes no `--model` and the CLI resolves from
// `~/.claude/settings.json` — the file other Claude Code clients write their
// `/model` pick to. That is why `model` is undefined in that branch rather
// than carrying a guess: at this layer the value genuinely is not known, and
// only the CLI's own `system`/`init` frame can report it (#2554).

import type { ChatModel } from "./models";

export type ChatModelSource = "session" | "role" | "global" | "shared";

export interface ResolvedChatModel {
  /** Passed as `claude --model <alias>`. Undefined → the flag is omitted. */
  model?: ChatModel;
  source: ChatModelSource;
}

/** Most specific wins: a one-off override on this conversation beats the role,
 *  which beats the app-wide setting, and absent from all three means the shared
 *  file decides. Built-in roles never carry a model — they have no editable
 *  surface — so they fall through without needing a special case. */
export function resolveChatModel(sessionModel: ChatModel | undefined, roleModel: ChatModel | undefined, globalModel: ChatModel | undefined): ResolvedChatModel {
  if (sessionModel) return { model: sessionModel, source: "session" };
  if (roleModel) return { model: roleModel, source: "role" };
  if (globalModel) return { model: globalModel, source: "global" };
  return { source: "shared" };
}
