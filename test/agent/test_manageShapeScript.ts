// The host side of `manageShapeScript`: the document it writes is the plugin's
// post plus the two server stamps mulmoserver's rules demand, an update carries
// only the one stamp the rules let move, a read the rules refuse is an absence,
// and the thumbnail and the script land under the owner's path the Storage
// rule scopes.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Firestore } from "firebase/firestore";
import type { FirebaseStorage } from "firebase/storage";
import { SHAPE_LICENSE, SHAPE_POST_KEYS, shapePostFrom, type ShapePostDoc } from "@mulmoclaude/shapescript-plugin";
import {
  galleryWriterFrom,
  isHiddenByRules,
  manageShapeScript,
  postDocumentOf,
  postStillMatches,
  postUpdateOf,
  shapeObjectPath,
} from "../../server/agent/mcp-tools/manageShapeScript.js";

const post = shapePostFrom({ uid: "u-alice", authorName: "Alice" }, { title: "Lamp", scriptId: "script-1", keywords: ["lamp"] });
const licensed: ShapePostDoc = { ...post, license: SHAPE_LICENSE };

const isServerStamp = (value: unknown): boolean =>
  typeof value === "object" && value !== null && (value as { _methodName?: string })._methodName === "serverTimestamp";

describe("manageShapeScript host adapter", () => {
  it("is offered with the shared contract, not a local copy of it", () => {
    assert.equal(manageShapeScript.definition.name, "manageShapeScript");
    assert.match(manageShapeScript.definition.description, /gallery/);
    const schema = manageShapeScript.definition.inputSchema as { properties: Record<string, unknown>; required: string[] };
    assert.equal(Object.keys(schema.properties)[0], "action");
    assert.deepEqual(schema.required, ["action"]);
  });

  it("writes the post plus server-stamped createdAt / updatedAt, and nothing else", () => {
    const document = postDocumentOf(post);
    assert.deepEqual(Object.keys(document), [...SHAPE_POST_KEYS, "createdAt", "updatedAt"]);
    // A FieldValue sentinel, not a client clock: the rules refuse `createdAt != request.time`.
    for (const key of ["createdAt", "updatedAt"]) assert.ok(isServerStamp(document[key]), key);
    // No grant, no stamp: the rules refuse `licenseAcceptedAt` beside a null license.
    assert.equal(document.license, null);
    assert.equal(Object.hasOwn(document, "licenseAcceptedAt"), false);
  });

  // The agreement's stamp is the server's too — the rules want `licenseAcceptedAt == request.time`
  // on the write that grants — and it sits where the rules list it, between `license` and the times.
  it("stamps the agreement beside a granted license, as the server's time", () => {
    const document = postDocumentOf(licensed);
    assert.deepEqual(Object.keys(document), [...SHAPE_POST_KEYS, "licenseAcceptedAt", "createdAt", "updatedAt"]);
    assert.equal(document.license, SHAPE_LICENSE);
    assert.ok(isServerStamp(document.licenseAcceptedAt));
  });

  it("updates only the fields the plugin gave, with a server-stamped updatedAt and never createdAt, which the rules freeze", () => {
    const update = postUpdateOf({ title: "Lamp 2", scriptId: "script-2" });
    assert.deepEqual(Object.keys(update), ["title", "scriptId", "updatedAt"]);
    assert.ok(isServerStamp(update.updatedAt));
    assert.equal(Object.hasOwn(update, "createdAt"), false);
    assert.equal(Object.hasOwn(update, "licenseAcceptedAt"), false);
  });

  // A `license` in the patch is the owner's first agreement: it goes with its server stamp. If
  // the document is licensed already (another client agreed since the read), the rules refuse
  // a grant restated — so both are dropped and the stored grant stands.
  it("stamps a first agreement in an update, and drops it when the post is licensed already", () => {
    const granting = postUpdateOf({ published: true, license: SHAPE_LICENSE });
    assert.deepEqual(Object.keys(granting), ["published", "license", "licenseAcceptedAt", "updatedAt"]);
    assert.equal(granting.license, SHAPE_LICENSE);
    assert.ok(isServerStamp(granting.licenseAcceptedAt));
    const already = postUpdateOf({ published: true, license: SHAPE_LICENSE }, true);
    assert.deepEqual(Object.keys(already), ["published", "updatedAt"]);
  });

  it("applies an update only while the post still carries the owner and object ids the plugin read", () => {
    const expect = { uid: "u-alice", scriptId: "script-1", thumbnailId: "obj-1", published: true };
    assert.equal(postStillMatches({ uid: "u-alice", scriptId: "script-1", thumbnailId: "obj-1", title: "Lamp" }, expect), true);
    assert.equal(postStillMatches({ uid: "u-alice", scriptId: "script-1", thumbnailId: "obj-1", published: true }, expect), true);
    assert.equal(postStillMatches({ uid: "u-alice", scriptId: "script-2", thumbnailId: "obj-1" }, expect), false);
    assert.equal(postStillMatches({ uid: "u-alice", scriptId: "script-1", thumbnailId: "obj-2" }, expect), false);
    assert.equal(postStillMatches({ uid: "u-bob", scriptId: "script-1", thumbnailId: "obj-1" }, expect), false);
    // The published state is part of the read the grant was decided from: a toggle in between
    // is a change. A document without the key reads as published, as the plugin reads it.
    assert.equal(postStillMatches({ uid: "u-alice", scriptId: "script-1", thumbnailId: "obj-1", published: false }, expect), false);
    assert.equal(postStillMatches({ uid: "u-alice", scriptId: "script-1", thumbnailId: "obj-1" }, { ...expect, published: false }), false);
    assert.equal(postStillMatches(undefined, expect), false);
  });

  // Another account's draft is refused by the rules; the gallery shows "not here" for it as
  // for a wrong id, and so does the tool. A transport fault is not that and stays an error.
  it("reads a rules-refused document as absent, and nothing else", () => {
    assert.equal(isHiddenByRules({ code: "permission-denied", message: "Missing or insufficient permissions." }), true);
    assert.equal(isHiddenByRules({ code: "unavailable" }), false);
    assert.equal(isHiddenByRules(new Error("network")), false);
    assert.equal(isHiddenByRules(null), false);
  });

  it("keeps a picture under the owner, where the Storage rule scopes writes", () => {
    assert.equal(shapeObjectPath("u-alice", "s-1", "o-1"), "shapes/u-alice/s-1/o-1");
  });

  it("posts as the session's user, with every read and write the plugin's contract needs", () => {
    const writer = galleryWriterFrom({ firestore: {} as Firestore, storage: {} as FirebaseStorage, uid: "u-alice", authorName: "Alice" });
    assert.equal(writer.uid, "u-alice");
    assert.equal(writer.authorName, "Alice");
    for (const member of [
      "createPost",
      "readPost",
      "updatePost",
      "deletePost",
      "listPosts",
      "readScript",
      "uploadThumbnail",
      "uploadScript",
      "deleteObject",
    ] as const) {
      assert.equal(typeof writer[member], "function", member);
    }
  });
});
