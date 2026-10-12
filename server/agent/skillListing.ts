import { isRecord } from "../utils/types.js";

/** What the CLI's `system`/`init` frame says it loaded for skills (#3406). */
export interface SkillListingSummary {
  skillCount: number;
  /** Installed plugins only — the CLI's own `builtin` plugins are left out. */
  pluginNames: string[];
}

// Above this many skills the listing alone outweighs MulmoClaude's whole system
// prompt, which is the point at which turning user settings off is worth it.
export const HEAVY_SKILL_COUNT = 300;

const BUILTIN_PLUGIN_PATH = "builtin";

function installedPluginNames(plugins: unknown): string[] {
  if (!Array.isArray(plugins)) return [];
  return plugins.flatMap((plugin) => {
    if (!isRecord(plugin) || typeof plugin.name !== "string" || plugin.path === BUILTIN_PLUGIN_PATH) return [];
    return [plugin.name];
  });
}

/** The skill summary of a raw CLI frame, or null when it is not an `init`
 *  frame carrying a skill list. */
export function summariseSkillListing(frame: unknown): SkillListingSummary | null {
  if (!isRecord(frame) || frame.type !== "system" || frame.subtype !== "init") return null;
  if (!Array.isArray(frame.skills)) return null;
  return { skillCount: frame.skills.length, pluginNames: installedPluginNames(frame.plugins) };
}

export function isSkillListingHeavy(summary: SkillListingSummary): boolean {
  return summary.skillCount >= HEAVY_SKILL_COUNT;
}
