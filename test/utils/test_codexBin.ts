import assert from "node:assert/strict";
import type { SpawnSyncReturns } from "node:child_process";
import path from "node:path";
import { describe, it } from "node:test";
import { CodexCliNotFoundError, codexBinPath, type CodexResolveOptions } from "../../server/utils/codexBin.js";

const winPath = path.win32;

describe("codexBinPath", () => {
  it("uses the command name directly outside Windows", () => {
    assert.equal(codexBinPath({ platform: "linux", resetCache: true }), "codex");
  });

  it("skips an unspawnable desktop binary and finds the current npm platform package", () => {
    const prefix = "C:\\npm";
    const desktop = "C:\\Program Files\\WindowsApps\\OpenAI.Codex\\codex.exe";
    const vendor = winPath.join(prefix, "node_modules", "@openai", "codex", "node_modules", "@openai", "codex-win32-x64", "vendor");
    const native = winPath.join(vendor, "x86_64-pc-windows-msvc", "bin", "codex.exe");
    const options: CodexResolveOptions = {
      platform: "win32",
      resetCache: true,
      existsSync: () => true,
      readdirSync: ((directory: string) => (directory === vendor ? ["x86_64-pc-windows-msvc"] : [])) as unknown as NonNullable<
        CodexResolveOptions["readdirSync"]
      >,
      spawnSync: ((command: string) => {
        if (command === "where.exe") return result(0, `${desktop}\n`);
        if (command === "npm.cmd") return result(0, prefix);
        return command === native ? result(0, "codex-cli 1.0") : result(1, "");
      }) as unknown as NonNullable<CodexResolveOptions["spawnSync"]>,
      env: {},
    };
    assert.equal(codexBinPath(options), native);
  });

  it("keeps compatibility with the older npm platform package layout", () => {
    const prefix = "C:\\npm";
    const vendor = winPath.join(prefix, "node_modules", "@openai", "codex", "node_modules", "@openai", "codex-win32-x64", "vendor");
    const native = winPath.join(vendor, "x86_64-pc-windows-msvc", "codex", "codex.exe");
    const options: CodexResolveOptions = {
      platform: "win32",
      resetCache: true,
      existsSync: () => true,
      readdirSync: ((directory: string) => (directory === vendor ? ["x86_64-pc-windows-msvc"] : [])) as unknown as NonNullable<
        CodexResolveOptions["readdirSync"]
      >,
      spawnSync: ((command: string) => {
        if (command === "where.exe") return result(1, "");
        if (command === "npm.cmd") return result(0, prefix);
        return command === native ? result(0, "codex-cli 0.100") : result(1, "");
      }) as unknown as NonNullable<CodexResolveOptions["spawnSync"]>,
      env: {},
    };
    assert.equal(codexBinPath(options), native);
  });

  it("returns an actionable error when no executable works", () => {
    assert.throws(
      () =>
        codexBinPath({
          platform: "win32",
          resetCache: true,
          existsSync: () => false,
          readdirSync: (() => []) as unknown as NonNullable<CodexResolveOptions["readdirSync"]>,
          spawnSync: (() => result(1, "")) as unknown as NonNullable<CodexResolveOptions["spawnSync"]>,
          env: {},
        }),
      (error: unknown) => error instanceof CodexCliNotFoundError && /npm install -g @openai\/codex/.test(error.message),
    );
  });
});

function result(status: number, stdout: string): SpawnSyncReturns<string> {
  return { pid: 1, output: [null, stdout, ""], stdout, stderr: "", status, signal: null };
}
