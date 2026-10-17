import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { isSpreadsheetArtifactPath } from "@gui-chat-plugin/spreadsheet";

// The package's guard is the only check between the View's dispatch path and a
// write under artifacts/. It replaced the host's isSpreadsheetPath, which also
// refused any ".." inside a name ("a..b.json"); the package allows those because
// such a segment cannot leave the directory. What must hold is the property
// below, over generated paths, not agreement with the old rule.

const PREFIX = "artifacts/spreadsheets/";
const SEGMENTS = [
  "",
  ".",
  "..",
  "a",
  "2026",
  "10",
  "x.json",
  "..x",
  "x..",
  "a..b.json",
  "a\\b",
  "\\",
  "%2e%2e",
  "a b",
  "é",
  "..json",
  ".json",
  "x.JSON",
  "x.jsonx",
  "/",
];
const PREFIXES = [
  PREFIX,
  "artifacts/spreadsheets",
  "/artifacts/spreadsheets/",
  "spreadsheets/",
  "artifacts/charts/",
  "artifacts//spreadsheets/",
  "./artifacts/spreadsheets/",
];
const TAILS = ["", ".json", "/x.json", "/../x.json"];

const joinPath = (prefix: string, first: string, second: string, tail: string): string => [prefix, first, second ? "/" : "", second, tail].join("");

const generatedPaths = (): string[] =>
  PREFIXES.flatMap((prefix) => SEGMENTS.flatMap((first) => SEGMENTS.flatMap((second) => TAILS.map((tail) => joinPath(prefix, first, second, tail)))));

describe("isSpreadsheetArtifactPath — what the dispatch may touch", () => {
  it("every accepted path stays inside artifacts/spreadsheets/ and is a .json file", () => {
    const accepted = generatedPaths().filter((candidate) => isSpreadsheetArtifactPath(candidate));
    assert.ok(accepted.length > 0, "the generator must produce accepted paths, or this checks nothing");
    accepted.forEach((candidate) => {
      assert.ok(path.posix.normalize(candidate).startsWith(PREFIX), candidate);
      assert.equal(candidate.endsWith(".json"), true, candidate);
      assert.equal(candidate.includes("\\"), false, candidate);
      assert.equal(
        candidate.split("/").some((segment) => segment === ".." || segment === "." || segment === ""),
        false,
        candidate,
      );
    });
  });

  it("accepts the paths MulmoClaude has always written", () => {
    ["artifacts/spreadsheets/2026/06/abc.json", "artifacts/spreadsheets/2026/10/0123456789abcdef.json", "artifacts/spreadsheets/abc123.json"].forEach(
      (stored) => {
        assert.equal(isSpreadsheetArtifactPath(stored), true, stored);
      },
    );
  });

  it("rejects traversal and other directories", () => {
    [
      "artifacts/spreadsheets/../spreadsheets/f.json",
      "artifacts/spreadsheets/../../etc/passwd.json",
      "artifacts/spreadsheets/./local.json",
      "artifacts/spreadsheets/../outside.json",
      "artifacts/spreadsheets/abc.csv",
      "artifacts/spreadsheets/foo",
      "artifacts/images/foo.json",
      "spreadsheets/foo.json",
      "foo.json",
      "",
    ].forEach((rejected) => {
      assert.equal(isSpreadsheetArtifactPath(rejected), false, rejected);
    });
  });
});
