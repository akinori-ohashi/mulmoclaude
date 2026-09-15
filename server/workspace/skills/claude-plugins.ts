// Claude Code installs skills two ways. Loose directories under
// `<claudeConfigDir>/skills/` are one; the other is a marketplace plugin
// (`/plugin install`) whose tree carries its own `skills/` directory. This
// module locates those trees.
//
// `installed_plugins.json` is CLI-internal state rather than a published
// contract — it already carries `"version": 2`, so the shape has changed at
// least once. Every field is read through a guard and a malformed entry is
// dropped, so a future shape change costs the plugin skills and leaves the
// rest of discovery working.

import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { log } from "../../system/logger/index.js";
import { hasTraversalSegment } from "../../utils/files/safe.js";
import { isErrorWithCode, isNonEmptyString, isRecord, isUnknownArray } from "../../utils/types.js";

/** What the CLI puts between a plugin's name and one of its skills, so
 *  `mulmocast:story` here names the same skill `Skill({skill:"mulmocast:story"})`
 *  runs. Also the reason a name WITHOUT it cannot be a plugin skill. */
export const PLUGIN_NAMESPACE_SEPARATOR = ":";

/** Whether a skill name could name one of a plugin's skills. Lets a by-name
 *  lookup skip the plugin scan entirely for the common case: measured on a
 *  machine with three plugins installed, that scan is 170 ms of the 180 ms a
 *  full `discoverSkills()` takes. */
export function couldBeClaudePluginSkill(skillName: string): boolean {
  return skillName.includes(PLUGIN_NAMESPACE_SEPARATOR);
}

export interface ClaudePluginInstall {
  /** Ledger key `<plugin>@<marketplace>` — how `enabledPlugins` addresses it. */
  key: string;
  /** The `<plugin>` half of the key. */
  pluginName: string;
  /** Absolute path to the installed plugin tree. */
  installPath: string;
}

export interface ClaudePluginSkillRoot {
  /** The namespace the CLI prefixes this plugin's skills with, so that
   *  `<pluginName>:<skill>` names the same skill the CLI would run. */
  pluginName: string;
  /** `<installPath>/skills` — absent on disk for a plugin that ships none. */
  skillsDir: string;
}

/** `<plugin>@<marketplace>` → `<plugin>`. A plugin name can itself be scoped
 *  (`@scope/name`), so the marketplace separator is the LAST `@`. */
export function pluginNameFromLedgerKey(key: string): string {
  const separator = key.lastIndexOf("@");
  return separator > 0 ? key.slice(0, separator) : key;
}

// A relative path would be followed from wherever the server process was started
// and a `..` segment points where the CLI never installed anything, so both mean
// a corrupt ledger rather than a plugin. Deliberately NOT confined to
// `<claudeConfigDir>/plugins/` on top of that: `claude plugin marketplace add`
// accepts a local path, so an install outside the cache is a supported shape.
function usableInstallPath(installPath: unknown, key: string): string | null {
  if (!isNonEmptyString(installPath)) return null;
  if (!isAbsolute(installPath) || hasTraversalSegment(installPath)) {
    log.warn("skills", "plugin ledger install path is not an absolute canonical path, skipping", { key, installPath });
    return null;
  }
  return installPath;
}

function installsForLedgerKey(key: string, entries: unknown): ClaudePluginInstall[] {
  const pluginName = pluginNameFromLedgerKey(key);
  if (pluginName.length === 0 || !isUnknownArray(entries)) return [];
  return entries.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const installPath = usableInstallPath(entry.installPath, key);
    return installPath ? [{ key, pluginName, installPath }] : [];
  });
}

/** Every install recorded in the ledger, in ledger order. */
export function parsePluginLedger(ledger: unknown): ClaudePluginInstall[] {
  if (!isRecord(ledger) || !isRecord(ledger.plugins)) return [];
  return Object.entries(ledger.plugins).flatMap(([key, entries]) => installsForLedgerKey(key, entries));
}

/** Plugin keys the user has switched OFF. A key the settings never mention
 *  counts as enabled: `/plugin install` writes `true` explicitly, so an absent
 *  key means hand-edited or pre-`enabledPlugins` state, not a refusal. */
export function disabledPluginKeys(settingsByAscendingPrecedence: readonly unknown[]): ReadonlySet<string> {
  const enablement = new Map<string, boolean>();
  settingsByAscendingPrecedence.forEach((settings) => {
    if (!isRecord(settings) || !isRecord(settings.enabledPlugins)) return;
    Object.entries(settings.enabledPlugins).forEach(([key, enabled]) => {
      if (typeof enabled === "boolean") enablement.set(key, enabled);
    });
  });
  return new Set([...enablement].filter(([, enabled]) => !enabled).map(([key]) => key));
}

/** One skills root per enabled plugin, in ledger order. A plugin installed at
 *  two scopes yields one root — both trees hold the same skill names, so the
 *  second could only shadow the first. */
export function pluginSkillRoots(installs: readonly ClaudePluginInstall[], disabledKeys: ReadonlySet<string>): ClaudePluginSkillRoot[] {
  const rootsByPluginName = new Map<string, ClaudePluginSkillRoot>();
  installs
    .filter((install) => !disabledKeys.has(install.key))
    .forEach((install) => {
      if (rootsByPluginName.has(install.pluginName)) return;
      rootsByPluginName.set(install.pluginName, {
        pluginName: install.pluginName,
        skillsDir: join(install.installPath, "skills"),
      });
    });
  return [...rootsByPluginName.values()];
}

// Same error policy as `readSkillDir`: a missing file is the common case (no
// plugins installed), anything else is logged so a permissions problem is
// findable rather than silently reading as "no plugins".
async function readJsonTolerant(path: string): Promise<unknown> {
  try {
    const raw = await readFile(path, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    return parsed;
  } catch (err) {
    if (!isErrorWithCode(err) || err.code !== "ENOENT") {
      log.warn("skills", "failed to read Claude plugin config, treating as absent", { path, error: String(err) });
    }
    return null;
  }
}

export interface ReadClaudePluginSkillRootsOptions {
  /** The CLI's `installed_plugins.json`. */
  ledgerPath: string;
  /** `settings.json` files whose `enabledPlugins` gate the result, in
   *  ascending precedence (user first, workspace last). */
  settingsPaths: readonly string[];
}

export async function readClaudePluginSkillRoots(opts: ReadClaudePluginSkillRootsOptions): Promise<ClaudePluginSkillRoot[]> {
  const installs = parsePluginLedger(await readJsonTolerant(opts.ledgerPath));
  if (installs.length === 0) return [];
  const settings = await Promise.all(opts.settingsPaths.map(readJsonTolerant));
  return pluginSkillRoots(installs, disabledPluginKeys(settings));
}
