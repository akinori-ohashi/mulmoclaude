import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

import { makeTempDir } from "../helpers/tempDir.js";
import {
  buildAllowedConfigMounts,
  resolveMountNames,
  configMountArgs,
  planConfigMounts,
  resolveSandboxAuth,
  sshAgentForwardArgs,
  SSH_AGENT_CONTAINER_SOCK,
} from "../../server/agent/sandboxMounts.js";

// Use an isolated temp HOME so these tests don't depend on whether
// the developer running CI actually has ~/.config/gh or a ~/.gitconfig.

// The host's own platform, because these fixtures are real paths the host
// spelled. `dockerMountArgs` converts separators and strips the drive letter for
// `win32` only, so naming another platform leaves a Windows path with its
// backslashes and pushes every mount onto `--mount` (#3218).
const HOST_PLATFORM = process.platform;

// `sshAgentForwardArgs` splits on darwin (Docker Desktop's magic socket) vs
// everything else (bind the host socket). The socket-binding branch needs a
// non-darwin platform, and it has to be one whose path spelling matches the
// host's — so a macOS runner stands in as "linux", while a Windows runner is
// already non-darwin and keeps its own.
const SOCKET_BINDING_PLATFORM = process.platform === "darwin" ? "linux" : process.platform;

// A directory NAME holding a colon or a comma is legal on POSIX and forbidden by
// NTFS, so these fixtures cannot be created on Windows at all.
const posixFilenamesOnly = { skip: process.platform === "win32" };

// `awkwardName` puts the fixture home inside a directory whose NAME carries the
// characters under test, which is the only way a resolved config path acquires
// one — the allowlist joins fixed segments onto `$HOME`.
function makeFixtureHome(opts: { gh?: boolean; gitconfig?: boolean }, awkwardName?: string): string {
  const root = makeTempDir("sandbox-mounts-");
  const dir = awkwardName === undefined ? root : path.join(root, awkwardName);
  if (awkwardName !== undefined) mkdirSync(dir, { recursive: true });
  if (opts.gh) {
    const ghDir = path.join(dir, ".config", "gh");
    mkdirSync(ghDir, { recursive: true });
    writeFileSync(path.join(ghDir, "hosts.yml"), "github.com:\n");
  }
  if (opts.gitconfig) {
    writeFileSync(path.join(dir, ".gitconfig"), "[user]\n  name = t\n");
  }
  return dir;
}

describe("buildAllowedConfigMounts", () => {
  it("exposes every expected name", () => {
    const allowed = buildAllowedConfigMounts("/fake/home");
    assert.deepEqual(Object.keys(allowed).sort(), ["gh", "gitconfig"]);
  });

  it("maps names to stable host paths under the given home", () => {
    const { gh, gitconfig } = buildAllowedConfigMounts("/fake/home");
    assert.ok(gh);
    assert.ok(gitconfig);
    assert.equal(gh.hostPath, path.join("/fake/home", ".config", "gh"));
    assert.equal(gh.containerPath, "/home/node/.config/gh");
    assert.equal(gh.kind, "dir");
    assert.equal(gitconfig.hostPath, path.join("/fake/home", ".gitconfig"));
    assert.equal(gitconfig.kind, "file");
  });
});

describe("resolveMountNames", () => {
  it("empty input → empty output", () => {
    const out = resolveMountNames([], buildAllowedConfigMounts("/fake/home"));
    assert.deepEqual(out, { resolved: [], unknown: [], missing: [] });
  });

  it("flags unknown names without crashing", () => {
    const out = resolveMountNames(["nope", "also-nope"], buildAllowedConfigMounts("/fake/home"));
    assert.deepEqual(out.unknown, ["nope", "also-nope"]);
    assert.equal(out.resolved.length, 0);
  });

  it("treats a prototype-chain name as unknown, not a phantom missing path", () => {
    // A bare `allowed["constructor"]` reads the Object.prototype function
    // (truthy), so the name skips `unknown` and later fails as "path missing"
    // — a misleading diagnosis for a Docker mount permission boundary.
    const out = resolveMountNames(["constructor", "toString", "__proto__"], buildAllowedConfigMounts("/fake/home"));
    assert.deepEqual(out.unknown, ["constructor", "toString", "__proto__"]);
    assert.equal(out.resolved.length, 0);
    assert.equal(out.missing.length, 0);
  });

  it("reports missing host paths separately from unknown", () => {
    const home = makeFixtureHome({}); // nothing on disk
    const out = resolveMountNames(["gh"], buildAllowedConfigMounts(home));
    assert.equal(out.unknown.length, 0);
    assert.equal(out.resolved.length, 0);
    assert.equal(out.missing.length, 1);
    const [missing] = out.missing;
    assert.ok(missing);
    assert.equal(missing.name, "gh");
  });

  it("resolves a present dir", () => {
    const home = makeFixtureHome({ gh: true });
    const out = resolveMountNames(["gh"], buildAllowedConfigMounts(home));
    assert.equal(out.resolved.length, 1);
    const [resolved] = out.resolved;
    assert.ok(resolved);
    assert.equal(resolved.name, "gh");
  });

  it("resolves a present file", () => {
    const home = makeFixtureHome({ gitconfig: true });
    const out = resolveMountNames(["gitconfig"], buildAllowedConfigMounts(home));
    assert.equal(out.resolved.length, 1);
    const [resolved] = out.resolved;
    assert.ok(resolved);
    assert.equal(resolved.name, "gitconfig");
  });

  it("rejects dir when host path is a file and vice versa", () => {
    const home = makeFixtureHome({ gh: false, gitconfig: false });
    // Place a FILE where gh expects a DIR.
    mkdirSync(path.join(home, ".config"), { recursive: true });
    writeFileSync(path.join(home, ".config", "gh"), "oops");
    const out = resolveMountNames(["gh"], buildAllowedConfigMounts(home));
    assert.equal(out.resolved.length, 0);
    assert.equal(out.missing.length, 1);
  });

  it("preserves CSV order, skips blanks", () => {
    const home = makeFixtureHome({ gh: true, gitconfig: true });
    const out = resolveMountNames(["gitconfig", "", "gh"], buildAllowedConfigMounts(home));
    assert.deepEqual(
      out.resolved.map((mount) => mount.name),
      ["gitconfig", "gh"],
    );
  });
});

describe("configMountArgs", () => {
  it("emits read-only -v pairs for each spec", () => {
    const home = makeFixtureHome({ gh: true, gitconfig: true });
    const { resolved } = resolveMountNames(["gh", "gitconfig"], buildAllowedConfigMounts(home));
    const args = configMountArgs(resolved);
    assert.equal(args.length, 4);
    const [ghFlag, ghMount, gitconfigFlag, gitconfigMount] = args;
    assert.ok(ghMount);
    assert.ok(gitconfigMount);
    assert.equal(ghFlag, "-v");
    assert.match(ghMount, /:\/home\/node\/\.config\/gh:ro$/);
    assert.equal(gitconfigFlag, "-v");
    assert.match(gitconfigMount, /:\/home\/node\/\.gitconfig:ro$/);
  });

  it("empty input → empty args", () => {
    assert.deepEqual(configMountArgs([]), []);
  });
});

// Three surfaces claim to report what is ATTACHED — the docker argv, the startup
// log, and GET /api/sandbox. Before #3191 nothing was ever skipped, so they could
// not disagree; once a path can be inexpressible they can, and the dangerous
// direction is claiming a credential reached the container when it did not.
describe("planConfigMounts — attached is what the container actually gets", () => {
  it("splits resolved specs into attached and skipped", () => {
    const home = makeFixtureHome({ gh: true, gitconfig: true });
    const { resolved } = resolveMountNames(["gh", "gitconfig"], buildAllowedConfigMounts(home));
    const plan = planConfigMounts(resolved, HOST_PLATFORM);
    assert.deepEqual(
      plan.attached.map((spec) => spec.name),
      ["gh", "gitconfig"],
    );
    assert.deepEqual(plan.skipped, []);
    assert.equal(plan.args.length, 4);
  });

  // A home holding both a colon and a comma cannot be carried by either flag.
  it("reports a spec no docker flag can express as skipped, not attached", posixFilenamesOnly, () => {
    const home = makeFixtureHome({ gh: true, gitconfig: true }, "with:colon,and-comma");
    const { resolved } = resolveMountNames(["gitconfig"], buildAllowedConfigMounts(home));
    assert.equal(resolved.length, 1, "the host path exists, so it resolves");

    const plan = planConfigMounts(resolved, "linux");
    assert.deepEqual(plan.args, [], "nothing can be mounted");
    assert.deepEqual(plan.attached, [], "so nothing may be reported as attached");
    assert.deepEqual(
      plan.skipped.map(({ spec }) => spec.name),
      ["gitconfig"],
    );
  });
});

describe("resolveSandboxAuth — the startup summary matches the argv", () => {
  it("omits a mount that could not be expressed from the attached list", posixFilenamesOnly, () => {
    const home = makeFixtureHome({ gitconfig: true }, "with:colon,and-comma");
    const auth = resolveSandboxAuth({ sshAgentForward: false, configMountNames: ["gitconfig"], home, platform: "linux" });
    assert.deepEqual(auth.args, [], "no docker argument was produced");
    assert.deepEqual(auth.appliedDescriptions, [], "so the log must not say it was attached");
  });

  it("still reports a mount that was expressed", () => {
    const home = makeFixtureHome({ gitconfig: true });
    const auth = resolveSandboxAuth({ sshAgentForward: false, configMountNames: ["gitconfig"], home, platform: HOST_PLATFORM });
    assert.equal(auth.args[0], "-v");
    assert.equal(auth.appliedDescriptions.length, 1);
    assert.match(auth.appliedDescriptions[0] ?? "", /^gitconfig /);
  });
});

describe("sshAgentForwardArgs", () => {
  it("no-op when disabled", () => {
    const result = sshAgentForwardArgs(false, "/tmp/anything");
    assert.deepEqual(result, { args: [], skippedReason: null });
  });

  it("uses Docker Desktop magic socket on macOS", () => {
    const result = sshAgentForwardArgs(true, "/tmp/irrelevant", "darwin");
    assert.equal(result.skippedReason, null);
    assert.deepEqual(result.args, ["-v", `/run/host-services/ssh-auth.sock:${SSH_AGENT_CONTAINER_SOCK}`, "-e", `SSH_AUTH_SOCK=${SSH_AGENT_CONTAINER_SOCK}`]);
  });

  it("macOS path ignores SSH_AUTH_SOCK value entirely", () => {
    const result = sshAgentForwardArgs(true, undefined, "darwin");
    assert.equal(result.skippedReason, null);
    assert.equal(result.args.length, 4);
  });

  it("reports SSH_AUTH_SOCK missing on Linux", () => {
    const result = sshAgentForwardArgs(true, undefined, "linux");
    assert.deepEqual(result.args, []);
    assert.match(result.skippedReason ?? "", /not set/);
  });

  it("reports socket path missing on disk (Linux)", () => {
    const result = sshAgentForwardArgs(true, "/tmp/definitely-not-a-real-sock", "linux");
    assert.deepEqual(result.args, []);
    assert.match(result.skippedReason ?? "", /not found/);
  });

  // Linux and Windows both bind the host socket directly. A fixed "linux" left
  // the Windows socket path unconverted, so the argument came out as `--mount`
  // with backslashes (#3218).
  it("binds socket and sets SSH_AUTH_SOCK when sock exists (non-macOS)", () => {
    const fake = path.join(makeTempDir("sock-"), "agent.sock");
    writeFileSync(fake, "");
    const result = sshAgentForwardArgs(true, fake, SOCKET_BINDING_PLATFORM);
    assert.equal(result.skippedReason, null);
    const expectedHostPath = fake.replace(/\\/g, "/");
    assert.deepEqual(result.args, ["-v", `${expectedHostPath}:${SSH_AGENT_CONTAINER_SOCK}`, "-e", `SSH_AUTH_SOCK=${SSH_AGENT_CONTAINER_SOCK}`]);
  });
});
