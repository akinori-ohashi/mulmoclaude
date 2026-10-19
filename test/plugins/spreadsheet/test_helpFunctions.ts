// The spreadsheet help is what the agent reads to learn which functions a
// formula may call, so its list must be exactly what the engine registers: a
// listed name the engine lacks evaluates to #NAME?, and an unlisted one is
// invisible to the agent.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { functionRegistry } from "../../../src/plugins/spreadsheet/engine/functions/index.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const HELP_PATH = path.join(repoRoot, "packages/core/assets/helps/spreadsheet.md");
// The engine upper-cases a name before looking it up, so match any case. The
// whole text is scanned rather than just the formulas in it, so a prose word
// written directly before "(" fails the check too — deliberately, as a false
// alarm is cheaper than a missed call.
const FUNCTION_CALL = /\b([A-Za-z][A-Za-z0-9]*)\(/g;

// A Windows checkout gives the help CRLF line endings.
const readHelp = (): string => readFileSync(HELP_PATH, "utf8").replaceAll("\r\n", "\n");

const calledFunctions = (text: string): string[] => [...text.matchAll(FUNCTION_CALL)].map((match) => match[1] ?? "");

/** `- Category: NAME, NAME` lines in the help's "Available Functions" section. */
const helpFunctionsByCategory = (help: string): Map<string, string[]> => {
  const start = help.indexOf("## Available Functions\n");
  assert.notEqual(start, -1, "the help has an Available Functions section");
  const end = help.indexOf("\n## ", start + 1);
  const section = help.slice(start, end === -1 ? undefined : end);
  const entries = [...section.matchAll(/^- ([^:\n]+): (.+)$/gm)].map((match): [string, string[]] => [
    (match[1] ?? "").trim(),
    (match[2] ?? "")
      .split(",")
      .map((name) => name.trim())
      .sort(),
  ]);
  const categories = entries.map(([category]) => category);
  assert.deepEqual(categories, [...new Set(categories)], "each category appears once");
  return new Map(entries);
};

const registeredByCategory = (): Map<string, string[]> =>
  new Map([...functionRegistry.getFunctionsByCategory()].map(([category, definitions]) => [category, definitions.map((definition) => definition.name).sort()]));

describe("spreadsheet help lists exactly the registered functions", () => {
  it("lists every registered function under its category, and nothing else", () => {
    assert.deepEqual(Object.fromEntries(helpFunctionsByCategory(readHelp())), Object.fromEntries(registeredByCategory()));
  });

  it("its formula examples only call registered functions", () => {
    const called = calledFunctions(readHelp());
    assert.ok(called.length > 0, "the help shows formula examples");
    assert.deepEqual(
      called.filter((name) => !functionRegistry.hasFunction(name)),
      [],
    );
  });
});
