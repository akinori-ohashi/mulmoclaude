// Attribution of `<workspace>/.server-port`: did THIS `yarn dev` write it, or a
// dead run? (#2981)
//
// It matters because the dev proxy now FOLLOWS that number. A leftover would
// send the client to a port this run's backend is not on — the same #2650
// mis-wiring the following is meant to end.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { wasRepublished } from "../../scripts/lib/publishedPort.js";

describe("wasRepublished", () => {
  it("a first publish counts — a fresh workspace has no port file", () => {
    assert.equal(wasRepublished({ exists: false, mtimeMs: 0 }, { exists: true, mtimeMs: 100 }), true);
  });

  it("an untouched file cannot speak for this run — `.server-port` outlives its writer", () => {
    assert.equal(wasRepublished({ exists: true, mtimeMs: 100 }, { exists: true, mtimeMs: 100 }), false);
  });

  it("a new mtime on the same bytes still counts — a restart onto the same port writes the same number", () => {
    assert.equal(wasRepublished({ exists: true, mtimeMs: 100 }, { exists: true, mtimeMs: 250 }), true);
  });

  it("a file that vanished is not a publish", () => {
    assert.equal(wasRepublished({ exists: true, mtimeMs: 100 }, { exists: false, mtimeMs: 0 }), false);
  });
});
