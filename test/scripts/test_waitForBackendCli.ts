// Integration cover for `scripts/wait-for-backend.ts` — real sockets, a real
// child process, the real CLI (#2981).
//
// The wait FOLLOWS the port the backend published rather than the one `PORT`
// asked for, so what has to be pinned here is the order: learn the port, then
// wait on it. Watching the `PORT`-derived port first is the bug this replaced —
// those two agree only when the request could be honoured, and #2650 is the case
// where it could not.
//
// Every case binds port 0 and reads back the assigned port, so nothing here
// depends on 3001 being free on the runner.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:net";
import { existsSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI = path.join(REPO_ROOT, "scripts", "wait-for-backend.ts");
const CLI_BUDGET_MS = 8000;
const PUBLISH_DELAY_MS = 400;
const PUBLISH_INTERVAL_MS = 200;
/** A port nothing is listening on, used as the `PORT` the run asked for. */
const UNSERVED_PORT = 3999;

interface Fixture {
  /** The port the fake backend actually bound. */
  boundPort: number;
  workspace: string;
  portFile: string;
  close: () => Promise<void>;
}

/**
 * Publish the port the way the real backend does — tmp file, then rename.
 *
 * `server/workspace/serverPort.ts` writes `.server-port` atomically precisely
 * because the waiter reads it while it is being written: a plain write opens
 * with `O_TRUNC`, so a reader landing between the truncate and the write sees an
 * EMPTY file and one landing mid-write sees a PREFIX — `3002` cut to `300`
 * parses as a perfectly valid port nothing is listening on. The CLI reads the
 * file once after the mtime moves, so a single torn read loses the whole wait.
 * A fake backend writing non-atomically would model a hazard the real one cannot
 * produce (CodeRabbit).
 */
function publishPort(fixture: Fixture): void {
  const tmp = `${fixture.portFile}.tmp`;
  writeFileSync(tmp, `${fixture.boundPort}\n`);
  renameSync(tmp, fixture.portFile);
}

async function startFakeBackend(): Promise<Fixture> {
  const workspace = mkdtempSync(path.join(tmpdir(), "wait-backend-test-"));
  const server: Server = createServer(() => {});
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address !== null && typeof address === "object", "expected a bound TCP address");
  return {
    boundPort: address.port,
    workspace,
    portFile: path.join(workspace, ".server-port"),
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          rmSync(workspace, { recursive: true, force: true });
          resolve();
        });
      }),
  };
}

function runCli(fixture: Fixture, opts: { port: number; args?: string[] } = { port: UNSERVED_PORT }): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--import", "tsx", CLI, ...(opts.args ?? [])], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        PORT: String(opts.port),
        MULMOCLAUDE_WORKSPACE_PATH: fixture.workspace,
        MULMOCLAUDE_DEV_WAIT_MS: String(CLI_BUDGET_MS),
      },
    });
    let out = "";
    child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (out += chunk.toString()));
    child.on("close", (code) => resolve({ code, out }));
  });
}

/**
 * Run the CLI while the fake backend publishes its port over and over.
 *
 * A single timed write raced the child's `tsx` boot. The CLI snapshots
 * `.server-port` only once it has booted, and a file that is already there at
 * the snapshot and never rewritten is — by design (#2981) — NOT a publish this
 * run may claim, so a boot slower than the delay left the wait falling back to
 * `PORT` forever. That is the leftover-file contract working, pinned on its own
 * below; it was the fixture that depended on the boot winning a race.
 *
 * Publishing until the child exits removes the dependency without weakening
 * anything: these cases have no `--reset` marker, so the only way they can pass
 * is a write that lands AFTER the snapshot — which is exactly the ordering they
 * exist to prove.
 */
async function runCliWhilePublishing(fixture: Fixture, opts?: { port: number; args?: string[] }): Promise<{ code: number | null; out: string }> {
  const publishing = setInterval(() => publishPort(fixture), PUBLISH_INTERVAL_MS);
  try {
    return await runCli(fixture, opts);
  } finally {
    clearInterval(publishing);
  }
}

describe("wait-for-backend CLI — follows the port the backend published", () => {
  let fixture: Fixture;

  before(async () => {
    fixture = await startFakeBackend();
  });
  after(async () => {
    await fixture.close();
  });

  it("waits on the WALKED-TO port, not the one PORT asked for", async () => {
    // The #2650 shape: `PORT` names a port the backend could not take, so it
    // bound another and published that. Nothing is listening on UNSERVED_PORT,
    // so a wait that watched it would time out; following the publish succeeds.
    rmSync(fixture.portFile, { force: true });

    const { code, out } = await runCliWhilePublishing(fixture);

    assert.equal(code, 0, out);
    assert.match(out, new RegExp(`backend ready on :${fixture.boundPort}`));
    assert.match(out, /published by this backend/);
    assert.doesNotMatch(out, new RegExp(`ready on :${UNSERVED_PORT}`));
  });

  it("does not follow a leftover file from a dead run", async () => {
    // Present before the wait begins and never rewritten, so it cannot speak for
    // this startup. Falling back to `PORT` is right: at least that is what Vite
    // will fall back to as well, so the two still agree.
    publishPort(fixture);

    const { code, out } = await runCli(fixture);

    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /published by this backend/);
    // And it must not call that "ready": with the default port busy, whatever
    // answered is the OTHER instance (Codex, #2981).
    assert.doesNotMatch(out, /backend ready on/);
  });

  it("--reset makes a later publish attributable", async () => {
    writeFileSync(fixture.portFile, "1\n");
    const reset = await runCli(fixture, { port: UNSERVED_PORT, args: ["--reset"] });
    assert.equal(reset.code, 0);
    assert.equal(existsSync(fixture.portFile), false, "--reset must remove the stale port file");

    // One timed write is safe here where it was not above: the marker makes the
    // file attributable, so a publish landing on EITHER side of the snapshot is
    // credited to this run. Nothing rides on which side wins.
    const publish = setTimeout(() => publishPort(fixture), PUBLISH_DELAY_MS);
    const { code, out } = await runCli(fixture);
    clearTimeout(publish);

    assert.equal(code, 0, out);
    assert.match(out, /published by this backend/);
  });

  it("PORT=0 is usable now — the published port is the answer config time could not compute", async () => {
    // `assertProxyablePort` refused this outright before, because an
    // OS-assigned port was unknowable when Vite evaluated its config. It is
    // knowable now: the backend binds it and says so.
    rmSync(fixture.portFile, { force: true });

    const { code, out } = await runCliWhilePublishing(fixture, { port: 0 });

    assert.equal(code, 0, out);
    assert.match(out, new RegExp(`backend ready on :${fixture.boundPort}`));
  });

  it("never reports readiness for a port nothing attributed to this startup", async () => {
    // The publication times out (nothing ever publishes) while the requested
    // port IS answering — the shape where another instance holds it. Claiming
    // "ready" there is the exact over-claim this file exists to avoid.
    rmSync(fixture.portFile, { force: true });
    const { code, out } = await runCli(fixture, { port: fixture.boundPort });

    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /backend ready on/);
    assert.match(out, /never published a port/);
    assert.match(out, /switch as soon as the backend publishes|set PORT/);
  });

  it("never refuses to start Vite — following removes the mismatch it used to guard", async () => {
    // The previous design exited 1 when the published port disagreed with the
    // proxy target. Vite follows now, so disagreement is not a state that
    // exists; nothing here should ever stop the client pane.
    rmSync(fixture.portFile, { force: true });

    const { code, out } = await runCliWhilePublishing(fixture);

    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /REFUS/i);
  });
});
