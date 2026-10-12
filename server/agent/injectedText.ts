import type { PendingSkill } from "./skillEvents.js";

/** What a `user`-role text block the CLI injected actually is.
 *
 *  With a Skill call pending it is the SKILL.md body. Otherwise it is the CLI's
 *  own context — an autocompact summary, an output-limit continuation — and never
 *  something the assistant wrote. The frame cannot tell them apart: all three
 *  carry `isSynthetic: true` (Claude Code 2.1.284), so the pending Skill is the
 *  only discriminator. */
export type InjectedTextKind = { kind: "skill-body"; skill: PendingSkill } | { kind: "cli-context" };

export function classifyInjectedText(pendingSkill: PendingSkill | null): InjectedTextKind {
  return pendingSkill ? { kind: "skill-body", skill: pendingSkill } : { kind: "cli-context" };
}
