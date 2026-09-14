// The host side of `publishShapeScript`: the document it writes is the plugin's
// post plus the two server stamps mulmoserver's rules demand, an update carries
// only the one stamp the rules let move, and the thumbnail and the script land
// under the owner's path the Storage rule scopes.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Firestore } from "firebase/firestore";
import type { FirebaseStorage } from "firebase/storage";
import { SHAPE_POST_KEYS, shapePostFrom } from "@mulmoclaude/shapescript-plugin";
import { galleryWriterFrom, postDocumentOf, postStillMatches, postUpdateOf, shapeObjectPath } from "../../server/agent/mcp-tools/publishShapeScript.js";

const post = shapePostFrom({ uid: "u-alice", authorName: "Alice" }, { title: "Lamp", scriptId: "script-1", keywords: ["lamp"] });

describe("publishShapeScript host adapter", () => {
  it("writes the post plus server-stamped createdAt / updatedAt, and nothing else", () => {
    const document = postDocumentOf(post);
    assert.deepEqual(Object.keys(document), [...SHAPE_POST_KEYS, "createdAt", "updatedAt"]);
    // A FieldValue sentinel, not a client clock: the rules refuse `createdAt != request.time`.
    for (const key of ["createdAt", "updatedAt"]) {
      const value = document[key] as { _methodName?: string };
      assert.equal(typeof value, "object");
      assert.equal(value._methodName, "serverTimestamp");
    }
  });

  it("updates only the fields the plugin gave, with a server-stamped updatedAt and never createdAt, which the rules freeze", () => {
    const update = postUpdateOf({ title: "Lamp 2", scriptId: "script-2" });
    assert.deepEqual(Object.keys(update), ["title", "scriptId", "updatedAt"]);
    assert.equal((update.updatedAt as { _methodName?: string })._methodName, "serverTimestamp");
    assert.equal(Object.hasOwn(update, "createdAt"), false);
  });

  it("applies an update only while the post still carries the owner and object ids the plugin read", () => {
    const expect = { uid: "u-alice", scriptId: "script-1", thumbnailId: "obj-1" };
    assert.equal(postStillMatches({ uid: "u-alice", scriptId: "script-1", thumbnailId: "obj-1", title: "Lamp" }, expect), true);
    assert.equal(postStillMatches({ uid: "u-alice", scriptId: "script-2", thumbnailId: "obj-1" }, expect), false);
    assert.equal(postStillMatches({ uid: "u-alice", scriptId: "script-1", thumbnailId: "obj-2" }, expect), false);
    assert.equal(postStillMatches({ uid: "u-bob", scriptId: "script-1", thumbnailId: "obj-1" }, expect), false);
    assert.equal(postStillMatches(undefined, expect), false);
  });

  it("keeps a picture under the owner, where the Storage rule scopes writes", () => {
    assert.equal(shapeObjectPath("u-alice", "s-1", "o-1"), "shapes/u-alice/s-1/o-1");
  });

  it("posts as the session's user, with every write the plugin's contract needs", () => {
    const writer = galleryWriterFrom({ firestore: {} as Firestore, storage: {} as FirebaseStorage, uid: "u-alice", authorName: "Alice" });
    assert.equal(writer.uid, "u-alice");
    assert.equal(writer.authorName, "Alice");
    assert.equal(typeof writer.createPost, "function");
    assert.equal(typeof writer.readPost, "function");
    assert.equal(typeof writer.updatePost, "function");
    assert.equal(typeof writer.uploadThumbnail, "function");
    assert.equal(typeof writer.uploadScript, "function");
    assert.equal(typeof writer.deleteObject, "function");
  });
});
