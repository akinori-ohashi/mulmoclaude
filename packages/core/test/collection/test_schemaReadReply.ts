import { test } from "node:test";
import assert from "node:assert/strict";

import { schemaReadReply } from "../../src/collection/server/schemaReadReply.ts";

const STAGED = '{"title":"New"}';
const ACTIVE = '{"title":"Old"}';

test("identical copies: the schema, with no note", () => {
  assert.equal(schemaReadReply("tasks", STAGED, STAGED), STAGED);
});

test("only one copy readable: that copy, with no note", () => {
  assert.equal(schemaReadReply("tasks", STAGED, null), STAGED);
  assert.equal(schemaReadReply("tasks", null, ACTIVE), ACTIVE);
});

test("neither copy readable: null, so the caller reports it", () => {
  assert.equal(schemaReadReply("tasks", null, null), null);
});

test("copies differ: a note naming both paths, then the staging copy verbatim", () => {
  const reply = schemaReadReply("tasks", STAGED, ACTIVE) ?? "";
  const [note, schema] = reply.split("\n\n");
  assert.match(note ?? "", /data\/skills\/tasks\/schema\.json/);
  assert.match(note ?? "", /DIFFERS from \.claude\/skills\/tasks\/schema\.json/);
  assert.match(note ?? "", /putSchema/);
  assert.equal(schema, STAGED);
});

test("an empty staging file still counts as a copy that differs", () => {
  const reply = schemaReadReply("tasks", "", ACTIVE) ?? "";
  assert.match(reply, /^manageCollection: NOTE/);
});

test("the slug in the note is the one passed in", () => {
  assert.match(schemaReadReply("my-list", STAGED, ACTIVE) ?? "", /\.claude\/skills\/my-list\/schema\.json/);
});
