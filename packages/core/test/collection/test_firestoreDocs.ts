// The `FirestoreDocs` seam owns the SDK, and `timestamp` is the member that
// makes that true for VALUES as well as calls (#3263).
//
// Why this test exists separately from the store's: the store is now tested
// against an in-memory fake that returns a plain `{ seconds, nanoseconds }`,
// which is all the codec duck-types on. Nothing there would notice if the REAL
// adapter stopped producing Firestore's own class — and it has to, because the
// stored document's field is compared by the deployed rules and a plain object
// is not a `Timestamp` to them.
//
// This file may import `firebase` directly: it is the SDK-bound half, the same
// side of the seam `collection/firestore` ships from.

import { test } from "node:test";
import assert from "node:assert/strict";
import { deleteApp, initializeApp } from "firebase/app";
import { getFirestore, Timestamp } from "firebase/firestore";

import { createFirestoreDocs } from "../../src/collection/server/firestoreDocs.ts";

const SECONDS = 1_700_000_000;
const NANOSECONDS = 123_456_789;

// Config only — no network. `getFirestore` hands back a handle; nothing here
// reads or writes, so no connection is ever opened.
test("the real adapter builds Firestore's own instant, carrying the parts it was given", async () => {
  const app = initializeApp({ projectId: "core-firestore-docs-test" }, "core-firestore-docs-test");
  try {
    const stamp = createFirestoreDocs(getFirestore(app)).timestamp(SECONDS, NANOSECONDS);
    assert.ok(stamp instanceof Timestamp, "a plain object would be refused by the rules the store writes under");
    assert.equal(stamp.seconds, SECONDS);
    assert.equal(stamp.nanoseconds, NANOSECONDS);
  } finally {
    await deleteApp(app);
  }
});
