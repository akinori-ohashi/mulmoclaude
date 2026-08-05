import { spawnSync as nodeSpawnSync, type SpawnSyncReturns } from "node:child_process";
import { existsSync as nodeExistsSync, readdirSync as nodeReaddirSync } from "node:fs";
import path from "node:path";

const winPath = path.win32;
const INSTALL_HINT = "Install with: npm install -g @openai/codex, then run: codex login";
const PARENT_WALK_DEPTH = 4;

export class CodexCliNotFoundError extends Error {
  constructor(message = "`codex` CLI is not available on PATH") {
    super(message);
    this.name = "CodexCliNotFoundError";
  }
}

export interface CodexResolveOptions {
  platform?: typeof process.platform;
  spawnSync?: typeof nodeSpawnSync;
  existsSync?: typeof nodeExistsSync;
  readdirSync?: typeof nodeReaddirSync;
  env?: typeof process.env;
  resetCache?: boolean;
}

let cachedBin: string | undefined;

export function codexBinPath(options: CodexResolveOptions = {}): string {
  if (options.resetCache) cachedBin = undefined;
  if (cachedBin) return cachedBin;
  if ((options.platform ?? process.platform) !== "win32") {
    cachedBin = "codex";
    return cachedBin;
  }
  const resolved = windowsCandidates(options).find((candidate) => fileExists(candidate, options) && isExecutable(candidate, options));
  if (!resolved) throw new CodexCliNotFoundError(`${INSTALL_HINT}`);
  cachedBin = resolved;
  return cachedBin;
}

function windowsCandidates(options: CodexResolveOptions): string[] {
  const candidates = directExeCandidates(options);
  for (const root of packageRoots(options)) candidates.push(...nativeExecutables(root, options));
  return [...new Set(candidates)];
}

function directExeCandidates(options: CodexResolveOptions): string[] {
  return probe(options, "where.exe", ["codex.exe"])
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((candidate) => candidate.length > 0 && !isDesktopAppBinary(candidate));
}

function isDesktopAppBinary(candidate: string): boolean {
  const normalised = candidate.toLowerCase();
  return normalised.includes("\\program files\\windowsapps\\openai.codex_");
}

function packageRoots(options: CodexResolveOptions): string[] {
  const roots: string[] = [];
  for (const wrapper of probe(options, "where.exe", ["codex.cmd"]).split(/\r?\n/)) {
    roots.push(...walkPackageRoots(winPath.dirname(wrapper.trim())));
  }
  const prefix = probe(options, "npm.cmd", ["config", "get", "prefix"]).trim();
  if (prefix) roots.push(winPath.join(prefix, "node_modules", "@openai", "codex"));
  const appData = (options.env ?? process.env).APPDATA;
  if (appData) roots.push(winPath.join(appData, "npm", "node_modules", "@openai", "codex"));
  return [...new Set(roots)];
}

function walkPackageRoots(start: string): string[] {
  const roots: string[] = [];
  let current = start;
  for (let depth = 0; depth <= PARENT_WALK_DEPTH; depth++) {
    roots.push(winPath.join(current, "node_modules", "@openai", "codex"));
    const parent = winPath.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return roots;
}

function nativeExecutables(packageRoot: string, options: CodexResolveOptions): string[] {
  const vendorRoots = [
    winPath.join(packageRoot, "vendor"),
    winPath.join(packageRoot, "node_modules", "@openai", "codex-win32-x64", "vendor"),
    winPath.join(winPath.dirname(packageRoot), "codex-win32-x64", "vendor"),
  ];
  return vendorRoots.flatMap((vendor) =>
    readDir(vendor, options).flatMap((entry) => [
      // Current @openai/codex platform packages (including 0.146.x).
      winPath.join(vendor, entry, "bin", "codex.exe"),
      // Older platform packages used a codex/ subdirectory.
      winPath.join(vendor, entry, "codex", "codex.exe"),
    ]),
  );
}

function readDir(directory: string, options: CodexResolveOptions): string[] {
  try {
    const entries: unknown = (options.readdirSync ?? nodeReaddirSync)(directory);
    return Array.isArray(entries) ? entries.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

function probe(options: CodexResolveOptions, command: string, args: string[]): string {
  const spawnSync = options.spawnSync ?? nodeSpawnSync;
  let result: SpawnSyncReturns<string>;
  try {
    result = spawnSync(command, args, { encoding: "utf8" });
  } catch {
    return "";
  }
  return result.status === 0 && typeof result.stdout === "string" ? result.stdout : "";
}

function isExecutable(candidate: string, options: CodexResolveOptions): boolean {
  const spawnSync = options.spawnSync ?? nodeSpawnSync;
  try {
    const result = spawnSync(candidate, ["--version"], { encoding: "utf8" });
    return !result.error && result.status === 0;
  } catch {
    return false;
  }
}

function fileExists(candidate: string, options: CodexResolveOptions): boolean {
  try {
    return (options.existsSync ?? nodeExistsSync)(candidate);
  } catch {
    return false;
  }
}
