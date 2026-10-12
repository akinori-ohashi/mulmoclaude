import { execSync } from "child_process";
import { existsSync, mkdirSync } from "fs";
import path from "path";
import { log } from "../system/logger/index.js";
import { EAGER_WORKSPACE_DIRS, WORKSPACE_PATHS, workspacePath } from "./paths.js";
import { readWorkspaceTextSync, writeWorkspaceTextSync } from "../utils/files/workspace-io.js";
import { loadCustomDirs, ensureCustomDirs } from "./custom-dirs.js";
import { seedTopicLayoutIfFresh } from "./memory/seed-topic-layout-run.js";
// Helps + preset skills + their sync logic now live in @mulmoclaude/core/workspace-setup
// (shared with MulmoTerminal); the bundled source dirs come from the package.
import { seedHelps, presetSkillsAssetDir, syncActivePresetSkills, syncPresetSkills } from "@mulmoclaude/core/workspace-setup";

// Re-exported so existing callers (`import { workspacePath } from
// "./workspace.js"`) keep working. See workspace-paths.ts for the
// definitive source.
export { workspacePath };

// Must exist before downstream modules call realpathSync(workspacePath) at their own module-load time.
mkdirSync(workspacePath, { recursive: true });

export function initWorkspace(): string {
  // Create directory structure if needed
  for (const key of EAGER_WORKSPACE_DIRS) {
    mkdirSync(WORKSPACE_PATHS[key], { recursive: true });
  }

  // Ensure the memory directory exists. A workspace with no memory to lose starts directly in the
  // topic layout (#1070); one that has any goes through the boot-time migration chain instead.
  mkdirSync(WORKSPACE_PATHS.memoryDir, { recursive: true });
  if (seedTopicLayoutIfFresh(workspacePath)) log.info("memory", "new workspace: starting in the topic memory layout");

  // Always sync the bundled help docs into workspace/helps/.
  seedHelps({ destDir: WORKSPACE_PATHS.helps });

  // Sync preset skills from `server/workspace/skills-preset/` into
  // the catalog (#1335 PR-A). Catalog entries are visible to UI /
  // tooling but NOT in `.claude/skills/`, so they don't enter
  // Claude Code's system prompt by default. Activation (catalog →
  // `.claude/skills/`) lands with the UI in #1335 PR-B; until then
  // the catalog is reachable by file path only. The dest directory
  // is created here because it's outside `EAGER_WORKSPACE_DIRS`
  // (it lives several levels deep and is preset-specific).
  mkdirSync(WORKSPACE_PATHS.skillsCatalogPreset, { recursive: true });
  syncPresetSkills({
    sourceDir: presetSkillsAssetDir(),
    destDir: WORKSPACE_PATHS.skillsCatalogPreset,
    onInfo: (message, data) => log.info("skills-preset", message, data),
    onWarn: (message, data) => log.warn("skills-preset", message, data),
  });

  // Also refresh the ACTIVE copy of any already-starred mc-* preset.
  // The catalog sync above keeps factory defaults fresh, but a user
  // who has ★ Starred an entry would otherwise see their active
  // `<workspace>/.claude/skills/<slug>/` stay forever pinned to the
  // version that was current when they starred — including bugs and
  // identifier renames. `syncActivePresetSkills` diffs each file
  // against source and overwrites differences, backing up any
  // pre-existing dest contents to `<file>.bak.<timestamp>` so a user
  // who had locally tweaked the preset can recover. Only `mc-*`
  // slugs are touched (defensive prefix check); user-authored skills
  // are never modified. Slugs that aren't starred yet are skipped
  // (never auto-starred).
  syncActivePresetSkills({
    sourceDir: presetSkillsAssetDir(),
    activeDir: WORKSPACE_PATHS.claudeSkills,
    onInfo: (message, data) => log.info("skills-preset", message, data),
    onWarn: (message, data) => log.warn("skills-preset", message, data),
  });

  // Create .gitignore if missing. The workspace is a git repo for
  // version-tracking user data, but cloned dev repos under github/
  // have their own .git and shouldn't be committed (#256). Runtime
  // files (`.session-token`, `.server-port`) are regenerated on
  // every startup and should never be committed (#917).
  ensureWorkspaceGitignore();

  // User-defined custom directories (#239)
  const customDirs = loadCustomDirs();
  if (customDirs.length > 0) {
    ensureCustomDirs(customDirs);
    log.info("workspace", "custom directories loaded", {
      count: customDirs.length,
    });
  }

  // Git init if not already a repo
  const gitDir = path.join(workspacePath, ".git");
  if (!existsSync(gitDir)) {
    execSync("git init", { cwd: workspacePath });
    log.info("workspace", "initialized git repository", { workspacePath });
  }

  log.info("workspace", "ready", { workspacePath });
  return workspacePath;
}

export const REQUIRED_GITIGNORE_LINES = [
  "github/", // cloned repos have their own .git
  ".session-token", // bearer token regenerated each startup
  ".server-port", // runtime port published for the LLM wiki-write hook
] as const;

const FRESH_GITIGNORE = [
  "# Cloned repositories have their own .git — don't nest",
  "github/",
  "",
  "# Auth token (regenerated each startup)",
  ".session-token",
  "",
  "# Bound port published at startup for the wiki-write hook",
  ".server-port",
  "",
].join("\n");

/** Decide what `.gitignore` should look like given its current
 *  content. Returns null when no rewrite is needed.
 *  - `null` existing → fresh template
 *  - existing missing required lines → existing + missing lines
 *    appended (preserves user customisation)
 *  - existing with all required lines → null (no change) */
export function nextGitignoreContent(existing: string | null): string | null {
  if (existing === null) return FRESH_GITIGNORE;
  // Treat the file as line-oriented; ignore comments and blanks for
  // the comparison so a user's annotated copy still counts as
  // having the line.
  const present = new Set(
    existing
      .split(/\r?\n/)
      .map((raw) => raw.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#")),
  );
  const missing = REQUIRED_GITIGNORE_LINES.filter((line) => !present.has(line));
  if (missing.length === 0) return null;
  const trailingNewline = existing.endsWith("\n") ? existing : `${existing}\n`;
  return `${trailingNewline}${missing.join("\n")}\n`;
}

function ensureWorkspaceGitignore(): void {
  const existing = readWorkspaceTextSync(".gitignore");
  const next = nextGitignoreContent(existing);
  if (next === null) return;
  writeWorkspaceTextSync(".gitignore", next);
}
