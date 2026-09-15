// Path helpers and slug validation for the skills module.
//
// This file holds the paths MulmoClaude can WRITE — the project scope, and the
// user root it must never write into. Which scopes are READ, and in what
// precedence, lives in `discovery.ts`.
//
// The slug doubles as a filename and appears in Claude CLI slash
// commands (`/<slug>`), so it has to be strict: no uppercase, no
// spaces, no path separators, no leading/trailing hyphens, 1-64
// chars. Same rule as `server/sources/paths.ts#isValidSlug` — keep
// them in sync manually.

import { join } from "node:path";
import { claudePluginLedgerPath, claudeSettingsPath, claudeSkillsDir } from "../../utils/claudeConfigPath.js";

export const SKILL_FILE = "SKILL.md";

/** `<claudeConfigDir>/skills/` — user scope, read-only from MulmoClaude.
 *  Default `~/.claude/skills/`; override via `CLAUDE_CONFIG_DIR` (issue #87 §2). */
export const USER_SKILLS_DIR = claudeSkillsDir();

/** `<claudeConfigDir>/plugins/installed_plugins.json` — the CLI's record of
 *  where each installed plugin's tree landed. */
export const CLAUDE_PLUGIN_LEDGER_PATH = claudePluginLedgerPath();

/** The `settings.json` files whose `enabledPlugins` decide which plugins
 *  contribute skills, in ascending precedence. `settings.local.json` is the
 *  per-machine override the CLI reads last. */
export function claudeSettingsPaths(workspaceRoot?: string): string[] {
  if (!workspaceRoot) return [claudeSettingsPath()];
  return [claudeSettingsPath(), join(workspaceRoot, ".claude", "settings.json"), join(workspaceRoot, ".claude", "settings.local.json")];
}

/** `<workspaceRoot>/.claude/skills/` — project scope, writable. */
export function projectSkillsDir(workspaceRoot: string): string {
  return join(workspaceRoot, ".claude", "skills");
}

/** Full path to the project-scope SKILL.md for a given slug. */
export function projectSkillPath(workspaceRoot: string, slug: string): string {
  return join(projectSkillsDir(workspaceRoot), slug, SKILL_FILE);
}

/** Directory holding a project skill (one level above SKILL.md). */
export function projectSkillDir(workspaceRoot: string, slug: string): string {
  return join(projectSkillsDir(workspaceRoot), slug);
}

/**
 * Strict slug validator. Rejects anything that could surprise the
 * filesystem, the Claude CLI slash-command resolver, or the URL
 * parser. Single source of truth for `save` / `delete` input.
 */
// isValidSlug moved to server/utils/slug.ts — import from there.
