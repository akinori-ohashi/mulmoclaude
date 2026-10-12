import { log } from "../system/logger/index.js";
import { isSkillListingHeavy, summariseSkillListing, type SkillListingSummary } from "./skillListing.js";

export interface LastSkillListing extends SkillListingSummary {
  heavy: boolean;
  /** ISO time of the turn whose `init` frame this came from. */
  seenAt: string;
}

let lastSkillListing: LastSkillListing | null = null;
// Each heavy count is warned about once per process: sessions with different
// counts interleave, so remembering only the previous count would repeat forever.
const warnedHeavySkillCounts = new Set<number>();

/** Record the skill summary of a raw CLI frame; a no-op for every frame but
 *  `init`. Returns whether this call logged the heavy-listing warning. */
export function noteSkillListing(frame: unknown, now: Date = new Date()): boolean {
  const summary = summariseSkillListing(frame);
  if (!summary) return false;
  const heavy = isSkillListingHeavy(summary);
  lastSkillListing = { ...summary, heavy, seenAt: now.toISOString() };
  log.debug("agent", "skill listing", { skillCount: summary.skillCount, plugins: summary.pluginNames });
  if (!heavy || warnedHeavySkillCounts.has(summary.skillCount)) return false;
  warnedHeavySkillCounts.add(summary.skillCount);
  log.warn("agent", "the CLI lists many skills on every request — Settings → Model can stop loading Claude Code's user settings and plugins", {
    skillCount: summary.skillCount,
    plugins: summary.pluginNames,
  });
  return true;
}

/** The most recent turn's skill summary, or null before any turn ran. */
export function getLastSkillListing(): LastSkillListing | null {
  return lastSkillListing;
}

export function _resetSkillListingForTest(): void {
  lastSkillListing = null;
  warnedHeavySkillCounts.clear();
}
