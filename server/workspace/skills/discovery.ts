// Scan the user's ~/.claude/skills/, the workspace-level
// <workspace>/.claude/skills/, and every installed Claude Code plugin's
// skills/ for SKILL.md files, parse them, and produce a deduped list.
// Project-level skills override user-level ones with the same name (mirrors
// settings precedence in #197), and both override a plugin's.

import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { log } from "../../system/logger/index.js";
import { parseSkillFrontmatter } from "./parser.js";
import { PLUGIN_NAMESPACE_SEPARATOR, readClaudePluginSkillRoots } from "./claude-plugins.js";
import { CLAUDE_PLUGIN_LEDGER_PATH, SKILL_FILE, USER_SKILLS_DIR, claudeSettingsPaths, projectSkillsDir } from "./paths.js";
import type { Skill, SkillSource } from "./types.js";
import { isErrorWithCode } from "../../utils/types.js";

// One directory entry → a parsed Skill, or null when the entry is
// not a valid skill (no SKILL.md, malformed frontmatter, I/O error).
// Errors are logged at warn, not thrown — a single broken skill
// shouldn't take down the whole list.
async function readSkillDir(skillDir: string, name: string, source: SkillSource): Promise<Skill | null> {
  const skillPath = join(skillDir, SKILL_FILE);
  try {
    // Follow symlinks: stat rather than lstat so a user's
    // `pptx@ → ~/ss/llm/skills/pptx/` reads through the link.
    const fileStat = await stat(skillPath);
    if (!fileStat.isFile()) return null;
    const raw = await readFile(skillPath, "utf-8");
    const parsed = parseSkillFrontmatter(raw);
    if (!parsed) {
      log.warn("skills", "SKILL.md has no usable frontmatter, skipping", {
        name,
        path: skillPath,
      });
      return null;
    }
    return {
      name,
      description: parsed.description,
      body: parsed.body,
      source,
      path: skillPath,
    };
  } catch (err) {
    // ENOENT = SKILL.md missing. Anything else is logged so a
    // permissions issue is findable; we still treat the slot as
    // "not a skill" rather than failing the whole list.
    if (!isErrorWithCode(err) || err.code !== "ENOENT") {
      log.warn("skills", "failed to read SKILL.md, skipping", {
        name,
        path: skillPath,
        error: String(err),
      });
    }
    return null;
  }
}

/**
 * Scan one skills root (the user's, the project's, or one plugin's) and
 * return every valid Skill. The root itself is allowed to not exist
 * — we just return an empty list (a workspace with no .claude/skills/
 * is the common case).
 *
 * `namePrefix` is prepended to each directory name, which is how a plugin's
 * skills carry the `<plugin>:` namespace the CLI addresses them by.
 */
export async function collectSkillsFromDir(root: string, source: SkillSource, namePrefix = ""): Promise<Skill[]> {
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch (err) {
    if (isErrorWithCode(err) && err.code === "ENOENT") return [];
    log.warn("skills", "failed to list skills dir, returning empty", {
      root,
      error: String(err),
    });
    return [];
  }

  const results: Skill[] = [];
  for (const name of entries) {
    // Skip hidden entries (.DS_Store, .gitkeep, etc.) up front.
    if (name.startsWith(".")) continue;
    const skillDir = resolve(root, name);
    let dirStat;
    try {
      // stat follows symlinks — supports `ln -s target skills/name`.
      dirStat = await stat(skillDir);
    } catch {
      continue;
    }
    if (!dirStat.isDirectory()) continue;
    const skill = await readSkillDir(skillDir, `${namePrefix}${name}`, source);
    if (skill) results.push(skill);
  }
  // Stable alphabetical order for the UI.
  results.sort((leftSkill, rightSkill) => leftSkill.name.localeCompare(rightSkill.name));
  return results;
}

export interface DiscoverSkillsOptions {
  /** Absolute path to the user's ~/.claude/skills/. Overridable for
   *  tests that point at mkdtempSync trees. */
  userDir?: string | undefined;
  /** Workspace root; project-level skills live at
   *  `<workspaceRoot>/.claude/skills/`. Passing undefined skips the
   *  project scope entirely. */
  workspaceRoot?: string | undefined;
  /** Set false where a plugin's skills would do harm rather than good — a
   *  listing whose entire text ships as one chat message, or a scheduler that
   *  would register a third-party plugin's schedule frontmatter as a task of
   *  its own. Defaults to including them. */
  includeClaudePlugins?: boolean | undefined;
  /** Absolute path to the CLI's `installed_plugins.json`. Overridable so a
   *  test reads its own ledger rather than the developer's real one. */
  pluginLedgerPath?: string | undefined;
  /** `settings.json` files consulted for `enabledPlugins`, in ascending
   *  precedence. Overridable for the same reason as `pluginLedgerPath`. */
  claudeSettingsPaths?: readonly string[] | undefined;
}

async function collectClaudePluginSkills(opts: DiscoverSkillsOptions): Promise<Skill[]> {
  if (opts.includeClaudePlugins === false) return [];
  const roots = await readClaudePluginSkillRoots({
    ledgerPath: opts.pluginLedgerPath ?? CLAUDE_PLUGIN_LEDGER_PATH,
    settingsPaths: opts.claudeSettingsPaths ?? claudeSettingsPaths(opts.workspaceRoot),
  });
  const skillsPerPlugin = await Promise.all(
    roots.map((root) => collectSkillsFromDir(root.skillsDir, "claude-plugin", `${root.pluginName}${PLUGIN_NAMESPACE_SEPARATOR}`)),
  );
  return skillsPerPlugin.flat();
}

/**
 * Discover every skill available to this workspace. Project-level
 * skills (under `<workspace>/.claude/skills/`) override user-level
 * skills of the same name, and both override a plugin's.
 */
export async function discoverSkills(opts: DiscoverSkillsOptions = {}): Promise<Skill[]> {
  const userDir = opts.userDir ?? USER_SKILLS_DIR;
  const userSkills = await collectSkillsFromDir(userDir, "user");

  const projectSkills = opts.workspaceRoot ? await collectSkillsFromDir(projectSkillsDir(opts.workspaceRoot), "project") : [];

  const pluginSkills = await collectClaudePluginSkills(opts);

  // Later scopes win on name collision, so a plugin the user installed can
  // never shadow a skill they wrote themselves.
  const merged = new Map<string, Skill>();
  [...pluginSkills, ...userSkills, ...projectSkills].forEach((skill) => merged.set(skill.name, skill));

  return [...merged.values()].sort((leftSkill, rightSkill) => leftSkill.name.localeCompare(rightSkill.name));
}
