// The `publishShapeScript` tool, against a fake gallery writer. What is pinned
// here is the CONTRACT with mulmoserver: the document's key set (its rules
// refuse any other), that the script is a Storage object the document points
// at rather than a field (receptron/mulmoserver#266), the keyword
// normalisation both sides share, that nothing is written when the host has
// no session, and that a refusal leaves no object behind.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { FileOps } from "gui-chat-protocol";
import {
  executePublishShapeScript,
  existingShapePost,
  normalizeShapeKeywords,
  shapePostFrom,
  shapePostUrl,
  NOT_CONNECTED_MESSAGE,
  POST_CHANGED_MESSAGE,
  PUBLISH_SCHEMA,
  PUBLISH_TOOL_NAME,
  requireScriptBytes,
  SHAPE_POST_KEYS,
  SHAPE_POST_LIMITS,
  SHAPE_SCRIPT_CONTENT_TYPE,
  type PublishShapeScriptContext,
  type ShapeGalleryWriter,
  type ShapePostDoc,
  type ShapePostPatch,
} from "../src/core/index";

const CUBE = "cube { size 1 }";

function memoryFiles(seed: Record<string, string> = {}): FileOps {
  const store = new Map(Object.entries(seed));
  const missing = (name: string) => (): never => {
    throw new Error(`FileOps.${name} is not part of this double`);
  };
  return {
    read: async (rel: string) => {
      const value = store.get(rel);
      if (value === undefined) throw new Error(`ENOENT: ${rel}`);
      return value;
    },
    write: async (rel: string, content: string | Uint8Array) => {
      store.set(rel, typeof content === "string" ? content : new TextDecoder().decode(content));
    },
    exists: async (rel: string) => store.has(rel),
    list: missing("list"),
    delete: missing("delete"),
    mkdir: missing("mkdir"),
    stat: missing("stat"),
  } as unknown as FileOps;
}

/** A writer that records what it was asked to do. `createPost` may be replaced
 *  to simulate a refused write. */
function fakeGallery(createPost?: ShapeGalleryWriter["createPost"], siteUrl?: string) {
  const posts = new Map<string, ShapePostDoc>();
  const uploads: Array<{ id: string; bytes: number }> = [];
  const scripts: Array<{ id: string; script: string }> = [];
  const deleted: Array<{ id: string; objectId: string }> = [];
  const patches: ShapePostPatch[] = [];
  const writer: ShapeGalleryWriter = {
    uid: "u-alice",
    authorName: "Alice",
    ...(siteUrl === undefined ? {} : { siteUrl }),
    createPost:
      createPost ??
      (async (id, doc) => {
        posts.set(id, doc);
      }),
    readPost: async (id) => {
      const stored = posts.get(id);
      return stored ? { ...stored, createdAt: "t0", updatedAt: "t0" } : null;
    },
    // Field-level, as Firestore's updateDoc is (a field absent from the patch is untouched),
    // and conditional, as the host's transaction is: refused unless the post still matches.
    updatePost: async (id, patch, expect) => {
      const stored = posts.get(id);
      if (!stored || stored.uid !== expect.uid || stored.scriptId !== expect.scriptId || stored.thumbnailId !== expect.thumbnailId) {
        throw new Error(POST_CHANGED_MESSAGE);
      }
      patches.push(patch);
      posts.set(id, { ...stored, ...patch });
    },
    uploadThumbnail: async (id, png) => {
      uploads.push({ id, bytes: png.byteLength });
      return `obj-${uploads.length}`;
    },
    uploadScript: async (id, script) => {
      scripts.push({ id, script });
      return `script-${scripts.length}`;
    },
    deleteObject: async (id, objectId) => {
      deleted.push({ id, objectId });
    },
  };
  return { writer, posts, uploads, scripts, deleted, patches };
}

const noThumbnail = async (): Promise<Uint8Array | null> => null;
const onePixel = async (): Promise<Uint8Array | null> => new Uint8Array([1, 2, 3]);

function contextFor(gallery: ShapeGalleryWriter | null, renderThumbnail = noThumbnail, files: FileOps = memoryFiles()): PublishShapeScriptContext {
  return { files: { artifacts: files }, gallery, renderThumbnail };
}

describe("publishShapeScript tool", () => {
  it("exposes its name and takes a title plus script XOR path", () => {
    assert.equal(PUBLISH_TOOL_NAME, "publishShapeScript");
    assert.deepEqual(Object.keys(PUBLISH_SCHEMA.properties), ["id", "title", "script", "path", "description", "keywords", "prompt", "aiModel", "published"]);
    // A new post needs a title and a source, an update (`id`) neither; the tool checks, the schema cannot.
    assert.deepEqual(PUBLISH_SCHEMA.required, []);
  });

  // mulmoserver's rules pin the key set with hasOnly: this list IS the contract.
  it("writes exactly the keys mulmoserver's rules accept, every one present, and never the script text", () => {
    const doc = shapePostFrom({ uid: "u", authorName: "A" }, { title: "Lamp", scriptId: "script-1" });
    assert.deepEqual(Object.keys(doc), [...SHAPE_POST_KEYS]);
    for (const [key, value] of Object.entries(doc)) assert.notEqual(value, undefined, `${key} must not be undefined`);
    // Key ABSENCE: the rule's hasOnly refuses a `script` key with any value.
    assert.equal(Object.hasOwn(doc, "script"), false);
    assert.deepEqual(
      { ...doc },
      {
        uid: "u",
        authorName: "A",
        title: "Lamp",
        description: "",
        scriptId: "script-1",
        source: "prompt",
        prompt: "",
        photoIds: [],
        thumbnailId: "",
        forkedFrom: null,
        keywords: [],
        aiModel: "",
        published: true,
      },
    );
  });

  it("normalises keywords the way the gallery does, from a list or a comma string", () => {
    assert.deepEqual(normalizeShapeKeywords([" Lamp", "lamp", "DESK ", "", 42, "x".repeat(40)]), ["lamp", "desk", "x".repeat(SHAPE_POST_LIMITS.keywordMax)]);
    assert.deepEqual(normalizeShapeKeywords("lamp, Desk lamp ,, wood"), ["lamp", "desk lamp", "wood"]);
    assert.equal(normalizeShapeKeywords(Array.from({ length: 14 }, (_, i) => `k${i}`)).length, SHAPE_POST_LIMITS.keywordsMax);
    assert.deepEqual(normalizeShapeKeywords(undefined), []);
  });

  it("refuses what the rules would refuse, naming the field", () => {
    const writer = { uid: "u", authorName: "A" };
    assert.throws(() => shapePostFrom(writer, { title: "  ", scriptId: "s" }), /`title` is required/);
    assert.throws(() => shapePostFrom(writer, { title: "x".repeat(121), scriptId: "s" }), /`title` is too long/);
    assert.throws(() => shapePostFrom(writer, { title: "t", scriptId: "s", description: "d".repeat(2001) }), /`description` is too long/);
    assert.equal(shapePostFrom({ uid: "u", authorName: "n".repeat(100) }, { title: "t", scriptId: "s" }).authorName.length, SHAPE_POST_LIMITS.authorNameMax);
    assert.throws(() => shapePostFrom(writer, { title: "t", scriptId: "s", aiModel: "m".repeat(81) }), /`aiModel` is too long/);
    assert.equal(shapePostFrom(writer, { title: "t", scriptId: "s", aiModel: " claude-opus-5 " }).aiModel, "claude-opus-5");
  });

  // The script cap is the gallery's STORAGE rule — 10 MiB in UTF-8 bytes — since the script is
  // an object, not a document field. Three-byte characters are over it although the character
  // count is well under; the cap itself, in ASCII, is not.
  it("measures the script in UTF-8 bytes against the Storage rule's 10 MiB", () => {
    assert.equal(SHAPE_POST_LIMITS.scriptMax, 10 * 1024 * 1024);
    assert.equal(SHAPE_SCRIPT_CONTENT_TYPE, "text/plain; charset=utf-8");
    assert.throws(() => requireScriptBytes(""), /`script` is required/);
    assert.throws(
      () => requireScriptBytes("あ".repeat(Math.ceil(SHAPE_POST_LIMITS.scriptMax / 3))),
      /`script` is too long \(\d+ bytes; the gallery allows 10485760\)/,
    );
    assert.equal(requireScriptBytes("x".repeat(SHAPE_POST_LIMITS.scriptMax)).length, SHAPE_POST_LIMITS.scriptMax);
  });

  it("posts nothing without a session, and says how to get one", async () => {
    await assert.rejects(executePublishShapeScript(contextFor(null), { title: "Lamp", script: CUBE }), new RegExp(NOT_CONNECTED_MESSAGE.slice(0, 30)));
  });

  it("publishes an inline script as a Storage object, with its thumbnail, and answers the model's URL", async () => {
    const { writer, posts, uploads, scripts } = fakeGallery();
    const result = await executePublishShapeScript(contextFor(writer, onePixel), {
      title: "Tiny Cube",
      script: CUBE,
      description: "A cube",
      keywords: ["Cube", "test"],
      prompt: "make a cube",
      aiModel: "claude-opus-5",
    });
    assert.equal(posts.size, 1);
    const [id, doc] = [...posts.entries()][0]!;
    assert.equal(result.id, id);
    assert.equal(result.url, shapePostUrl(id));
    assert.match(result.url, /^https:\/\/server\.mulmocast\.com\/shapes\/[0-9a-f-]{36}$/);
    assert.equal(result.thumbnail, true);
    assert.deepEqual(uploads, [{ id, bytes: 3 }]);
    assert.deepEqual(scripts, [{ id, script: CUBE }]);
    assert.equal(doc.thumbnailId, "obj-1");
    assert.equal(doc.scriptId, "script-1");
    assert.equal(Object.hasOwn(doc, "script"), false);
    assert.deepEqual(doc.keywords, ["cube", "test"]);
    assert.equal(doc.prompt, "make a cube");
    assert.equal(doc.aiModel, "claude-opus-5");
    assert.equal(doc.published, true);
    assert.match(result.message, /^Published: "Tiny Cube" is at https:/);
    assert.doesNotMatch(result.message, /No thumbnail/);
  });

  it("publishes an existing artifact by path, as a draft, where no browser can render", async () => {
    const { writer, posts, scripts } = fakeGallery(undefined, "https://staging.example/");
    const artifacts = memoryFiles({ "shapes/lamp-1-aaaaaaaa.shape": CUBE });
    const result = await executePublishShapeScript(contextFor(writer, noThumbnail, artifacts), {
      title: "Lamp",
      path: "artifacts/shapes/lamp-1-aaaaaaaa.shape",
      published: false,
    });
    const doc = [...posts.values()][0]!;
    assert.equal(scripts[0]?.script, CUBE);
    assert.equal(doc.scriptId, "script-1");
    assert.equal(doc.published, false);
    assert.equal(result.thumbnail, false);
    assert.equal(result.url, `https://staging.example/shapes/${result.id}`);
    assert.match(result.message, /^Saved as a draft/);
    assert.match(result.message, /No thumbnail could be attached/);
  });

  it("posts without a picture when the thumbnail fails, and says so as a warning", async () => {
    const { writer, posts } = fakeGallery();
    const warnings: string[] = [];
    const failing = async (): Promise<Uint8Array | null> => {
      throw new Error("no GPU");
    };
    const result = await executePublishShapeScript({ ...contextFor(writer, failing), onWarning: (m) => warnings.push(m) }, { title: "Lamp", script: CUBE });
    assert.equal(posts.size, 1);
    assert.equal(result.thumbnail, false);
    assert.deepEqual(warnings, ["thumbnail skipped: no GPU"]);
  });

  it("refuses a script that will not build, or a post over a limit, before anything is uploaded or written", async () => {
    const { writer, posts, uploads, scripts } = fakeGallery();
    const context = contextFor(writer, onePixel);
    await assert.rejects(executePublishShapeScript(context, { title: "Bad", script: "loft { square }" }), /cross-sections/);
    await assert.rejects(executePublishShapeScript(context, { title: "x".repeat(121), script: CUBE }), /`title` is too long/);
    await assert.rejects(executePublishShapeScript(context, { script: CUBE }), /`title` is required/);
    await assert.rejects(executePublishShapeScript(context, { title: "t", script: CUBE, path: "artifacts/shapes/x.shape" }), /not both/);
    await assert.rejects(executePublishShapeScript(context, { title: "t", script: "x".repeat(SHAPE_POST_LIMITS.scriptMax + 1) }), /`script` is too long/);
    assert.equal(posts.size, 0);
    assert.deepEqual(uploads, []);
    assert.deepEqual(scripts, []);
  });

  // The script goes up before the thumbnail: it is the required one, so its failure must find
  // nothing already uploaded to orphan.
  it("uploads the script before the thumbnail, so a failed script upload leaves nothing behind", async () => {
    const { writer, posts, uploads, deleted } = fakeGallery();
    writer.uploadScript = async () => {
      throw new Error("quota");
    };
    await assert.rejects(executePublishShapeScript(contextFor(writer, onePixel), { title: "Lamp", script: CUBE }), /quota/);
    assert.equal(posts.size, 0);
    assert.deepEqual(uploads, []);
    assert.deepEqual(deleted, []);
  });

  it("takes the script and the thumbnail back out when the post itself is refused", async () => {
    const { writer, uploads, deleted } = fakeGallery(async () => {
      throw new Error("permission-denied");
    });
    await assert.rejects(executePublishShapeScript(contextFor(writer, onePixel), { title: "Lamp", script: CUBE }), /permission-denied/);
    assert.equal(uploads.length, 1);
    const id = uploads[0]!.id;
    assert.deepEqual(deleted, [
      { id, objectId: "script-1" },
      { id, objectId: "obj-1" },
    ]);
  });

  // A post already in the gallery is rewritten in place — by its publisher only.
  describe("with `id` — updating a published post", () => {
    const CUBE_2 = "cube { size 2 }";
    async function seeded() {
      const gallery = fakeGallery();
      const context = contextFor(gallery.writer, onePixel);
      const first = await executePublishShapeScript(context, { title: "Lamp", script: CUBE, description: "v1", keywords: ["lamp"], aiModel: "claude-opus-5" });
      return { ...gallery, context, id: first.id };
    }

    it("coerces a stored document, filling keys a post from before they existed lacks", () => {
      const post = existingShapePost({
        uid: "u",
        authorName: "A",
        title: "Old",
        scriptId: "s",
        source: "photos",
        photoIds: ["p1", 2],
        forkedFrom: "f",
        published: true,
        createdAt: "t",
      });
      assert.deepEqual(Object.keys(post), [...SHAPE_POST_KEYS]);
      assert.equal(post.description, "");
      assert.deepEqual(post.keywords, []);
      assert.equal(post.aiModel, "");
      assert.equal(post.source, "photos");
      assert.deepEqual(post.photoIds, ["p1"]);
      assert.equal(post.forkedFrom, "f");
    });

    it("replaces the script and thumbnail, keeps every field not given, and answers the same URL", async () => {
      const { context, posts, scripts, uploads, deleted, id } = await seeded();
      const result = await executePublishShapeScript(context, { id, script: CUBE_2 });
      assert.equal(result.id, id);
      assert.equal(result.url, shapePostUrl(id));
      assert.match(result.message, /^Updated: "Lamp" is at https:/);
      assert.equal(posts.size, 1);
      const doc = posts.get(id)!;
      assert.deepEqual(
        scripts.map((entry) => entry.script),
        [CUBE, CUBE_2],
      );
      assert.equal(doc.scriptId, "script-2");
      assert.equal(doc.thumbnailId, "obj-2");
      assert.equal(uploads.length, 2);
      assert.equal(doc.title, "Lamp");
      assert.equal(doc.description, "v1");
      assert.deepEqual(doc.keywords, ["lamp"]);
      assert.equal(doc.aiModel, "claude-opus-5");
      assert.equal(doc.uid, "u-alice");
      // The replaced objects are gone, and only they.
      assert.deepEqual(deleted, [
        { id, objectId: "script-1" },
        { id, objectId: "obj-1" },
      ]);
    });

    // Codex on #3158: a whole-document rewrite from a read taken a moment ago would put back
    // whatever another client changed in between — a replaced (and deleted) script object
    // included. So the patch carries only what this call changes.
    it("sends only the fields given and the new object ids, never the whole snapshot", async () => {
      const { context, patches, id } = await seeded();
      await executePublishShapeScript(context, { id, script: CUBE_2 });
      assert.deepEqual(patches.at(-1), { scriptId: "script-2", thumbnailId: "obj-2" });
      await executePublishShapeScript(context, { id, title: "Desk lamp", keywords: ["Desk", "lamp"] });
      assert.deepEqual(patches.at(-1), { title: "Desk lamp", keywords: ["desk", "lamp"] });
    });

    it("clears an optional text field with an explicit empty string, and keeps it when omitted", async () => {
      const { context, posts, patches, id } = await seeded();
      await executePublishShapeScript(context, { id, description: "", aiModel: "" });
      assert.deepEqual(patches.at(-1), { description: "", aiModel: "" });
      assert.equal(posts.get(id)!.description, "");
      assert.equal(posts.get(id)!.aiModel, "");
      await executePublishShapeScript(context, { id, title: "Lamp 2" });
      assert.equal(posts.get(id)!.description, "");
      // An empty title is not a clear: the gallery requires one.
      await assert.rejects(executePublishShapeScript(context, { id, title: "" }), /`title` is required/);
    });

    it("updates the metadata alone — no source given keeps the script and thumbnail", async () => {
      const { context, posts, scripts, deleted, id } = await seeded();
      const result = await executePublishShapeScript(context, { id, title: "Desk lamp", keywords: ["lamp", "desk"], published: false });
      const doc = posts.get(id)!;
      assert.equal(scripts.length, 1);
      assert.deepEqual(deleted, []);
      assert.equal(doc.scriptId, "script-1");
      assert.equal(doc.thumbnailId, "obj-1");
      assert.equal(doc.title, "Desk lamp");
      assert.deepEqual(doc.keywords, ["lamp", "desk"]);
      assert.equal(doc.published, false);
      assert.equal(doc.description, "v1");
      assert.match(result.message, /^Updated as a draft/);
    });

    it("refuses an id that is not a post, and one published by another account, before anything is uploaded", async () => {
      const { context, writer, posts, scripts, id } = await seeded();
      await assert.rejects(executePublishShapeScript(context, { id: "no-such-post", script: CUBE_2 }), /No gallery post has the id "no-such-post"/);
      writer.uid = "u-bob";
      await assert.rejects(executePublishShapeScript(context, { id, script: CUBE_2 }), /published by another account; only its publisher/);
      assert.equal(scripts.length, 1);
      assert.equal(posts.get(id)!.scriptId, "script-1");
    });

    it("refuses a broken script or an over-limit field before anything is uploaded", async () => {
      const { context, scripts, uploads, id } = await seeded();
      await assert.rejects(executePublishShapeScript(context, { id, script: "loft { square }" }), /cross-sections/);
      await assert.rejects(executePublishShapeScript(context, { id, title: "x".repeat(121) }), /`title` is too long/);
      assert.equal(scripts.length, 1);
      assert.equal(uploads.length, 1);
    });

    it("takes the new objects back out when the rewrite is refused, and leaves the old post intact", async () => {
      const { context, writer, posts, deleted, id } = await seeded();
      writer.updatePost = async () => {
        throw new Error("permission-denied");
      };
      await assert.rejects(executePublishShapeScript(context, { id, script: CUBE_2 }), /permission-denied/);
      assert.deepEqual(deleted, [
        { id, objectId: "script-2" },
        { id, objectId: "obj-2" },
      ]);
      assert.equal(posts.get(id)!.scriptId, "script-1");
    });

    // CodeRabbit on #3158: two edits racing on one post. The write is conditional on the
    // object ids the read saw, so the second to land is refused and takes its uploads back
    // out — the first's objects stay referenced, nothing is orphaned.
    it("refuses an update whose read is stale — another edit replaced the model — and takes its uploads back out", async () => {
      const { context, writer, posts, deleted, id } = await seeded();
      const slowRead = writer.readPost;
      writer.readPost = async (postId) => {
        const snapshot = await slowRead(postId);
        // Another client's edit lands between this read and the write.
        posts.set(id, { ...posts.get(id)!, scriptId: "script-other", thumbnailId: "obj-other" });
        return snapshot;
      };
      await assert.rejects(executePublishShapeScript(context, { id, script: CUBE_2 }), new RegExp(POST_CHANGED_MESSAGE.slice(0, 40)));
      assert.deepEqual(deleted, [
        { id, objectId: "script-2" },
        { id, objectId: "obj-2" },
      ]);
      assert.equal(posts.get(id)!.scriptId, "script-other");
    });
  });
});
