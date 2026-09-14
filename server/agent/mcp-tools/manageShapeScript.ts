// `manageShapeScript` — the user's ShapeScript models in the public gallery on
// mulmoserver (server.mulmocast.com/shapes): publish, update, delete, get, getList.
//
// A pure MCP tool like `exportShapeScriptUsdz`: no View, the answer is a URL
// or, for the two reads, JSON. Everything a model sees — schema, description,
// the document a post is, the keyword rules — lives in
// `@mulmoclaude/shapescript-plugin`, and that entry is Firebase-free on
// purpose. What this host contributes is the signed-in session: the
// remote-host runner signs into mulmoserver's Firebase AS THE USER
// (docs/remote-host.md, "Option B"), so a post is a plain Firestore write on
// `shapes/{id}` that the gallery's rules accept because `uid == request.auth.uid`,
// and the reads are the queries the gallery's own pages run. No session → the
// tool says how to connect one.
//
// The thumbnail comes from the same renderer `renderShapeScript` uses; a host
// without Chromium posts without a picture rather than failing. The script
// itself is a Storage object too (receptron/mulmoserver#266): the document
// carries its id, never the text — so `get` downloads it from under its owner.
import {
  executeManageShapeScript,
  MANAGE_DESCRIPTION,
  MANAGE_PROMPT,
  MANAGE_SCHEMA,
  MANAGE_TOOL_NAME,
  SHAPE_OBJECT_CACHE_CONTROL,
  SHAPE_SCRIPT_CONTENT_TYPE,
  type ShapeGalleryWriter,
  type ShapePostDoc,
  POST_CHANGED_MESSAGE,
  type ShapePostExpect,
  type ShapePostPatch,
} from "@mulmoclaude/shapescript-plugin";
import { renderShapeThumbnail, MANAGE_TOOL_TIMEOUT_MS } from "@mulmoclaude/shapescript-plugin/render";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit as limitTo,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where,
  type Firestore,
} from "firebase/firestore";
import { deleteObject, getBytes, ref as storageRef, uploadBytes, type FirebaseStorage } from "firebase/storage";
import { currentDisplayName, currentFirestoreSession, currentStorage } from "../../remoteHost/session.js";
import { log } from "../../system/logger/index.js";
import { shapeFiles } from "./exportShapeScriptUsdz.js";
import type { McpTool } from "./index.js";

const SHAPES = "shapes";
const THUMBNAIL_TYPE = "image/png";

/** The document as written: the post plus the two stamps the rules demand be
 *  the server's. Exported for the test that pins it. */
export function postDocumentOf(post: ShapePostDoc): Record<string, unknown> {
  return { ...post, createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
}

/** The update as written: only the fields the plugin gave plus a server `updatedAt`, and NO
 *  `createdAt` — the rules freeze it. Field-level (`updateDoc`), so a field not given keeps
 *  what the document holds now, not what a read a moment ago saw. */
export function postUpdateOf(patch: ShapePostPatch): Record<string, unknown> {
  return { ...patch, updatedAt: serverTimestamp() };
}

/** Whether the stored document is still the one the plugin merged against: same owner, same
 *  object ids. Object ids are minted per upload, so a match means no edit landed in between. */
export function postStillMatches(data: Record<string, unknown> | undefined, expect: ShapePostExpect): boolean {
  return data !== undefined && data.uid === expect.uid && data.scriptId === expect.scriptId && data.thumbnailId === expect.thumbnailId;
}

/** A read the rules refused — another account's draft. The gallery shows the same "not here"
 *  for that as for a wrong id, and so does the tool: both are null, not an error. */
export function isHiddenByRules(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "permission-denied";
}

/** Where a post's objects live in Storage — `shapes/{uid}/{shapeId}/{objectId}`,
 *  under the owner so the Storage rule scopes writes without a Firestore read. */
export function shapeObjectPath(uid: string, shapeId: string, objectId: string): string {
  return `${SHAPES}/${uid}/${shapeId}/${objectId}`;
}

/** The writer over one signed-in session: the Firestore document, and the
 *  Storage objects — the card's picture and the script — under
 *  `shapes/{uid}/{id}/…`, the path the Storage rule lets the owner write.
 *  Every object goes out immutable-cacheable: its id is minted here and it is
 *  never rewritten. */
export function galleryWriterFrom(session: { firestore: Firestore; storage: FirebaseStorage; uid: string; authorName: string }): ShapeGalleryWriter {
  const post = (shapeId: string) => doc(session.firestore, SHAPES, shapeId);
  const upload = async (shapeId: string, bytes: Uint8Array | string, contentType: string): Promise<string> => {
    const objectId = crypto.randomUUID();
    const data = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
    await uploadBytes(storageRef(session.storage, shapeObjectPath(session.uid, shapeId, objectId)), data, {
      contentType,
      cacheControl: SHAPE_OBJECT_CACHE_CONTROL,
    });
    return objectId;
  };
  return {
    uid: session.uid,
    authorName: session.authorName,
    createPost: (shapeId, post_) => setDoc(post(shapeId), postDocumentOf(post_)),
    readPost: async (shapeId) => {
      try {
        const snapshot = await getDoc(post(shapeId));
        return snapshot.exists() ? snapshot.data() : null;
      } catch (error) {
        if (isHiddenByRules(error)) return null;
        throw error;
      }
    },
    // A transaction: the check and the field-level update are one atomic step, so a
    // concurrent edit either lands before (and this one is refused) or after (and sees ours).
    updatePost: (shapeId, patch, expect) =>
      runTransaction(session.firestore, async (transaction) => {
        const snapshot = await transaction.get(post(shapeId));
        if (!postStillMatches(snapshot.data(), expect)) throw new Error(POST_CHANGED_MESSAGE);
        transaction.update(post(shapeId), postUpdateOf(patch));
      }),
    deletePost: (shapeId) => deleteDoc(post(shapeId)),
    // The gallery's own "My models" query: the rules admit it because `uid == me` holds
    // for every row, and the (uid, createdAt desc) composite index serves it.
    listPosts: async (uid, count) => {
      const snapshot = await getDocs(query(collection(session.firestore, SHAPES), where("uid", "==", uid), orderBy("createdAt", "desc"), limitTo(count)));
      return snapshot.docs.map((row) => ({ id: row.id, data: row.data() }));
    },
    readScript: async (ownerUid, shapeId, scriptId) =>
      new TextDecoder().decode(await getBytes(storageRef(session.storage, shapeObjectPath(ownerUid, shapeId, scriptId)))),
    uploadThumbnail: (shapeId, png) => upload(shapeId, png, THUMBNAIL_TYPE),
    uploadScript: (shapeId, script) => upload(shapeId, script, SHAPE_SCRIPT_CONTENT_TYPE),
    deleteObject: (shapeId, objectId) => deleteObject(storageRef(session.storage, shapeObjectPath(session.uid, shapeId, objectId))),
  };
}

/** The live session as a writer, or null when Remote Host is not connected. */
function currentGallery(): ShapeGalleryWriter | null {
  const session = currentFirestoreSession();
  if (!session) return null;
  return galleryWriterFrom({ firestore: session.firestore, storage: currentStorage(), uid: session.uid, authorName: currentDisplayName() ?? "" });
}

export const manageShapeScript: McpTool = {
  definition: {
    name: MANAGE_TOOL_NAME,
    description: MANAGE_DESCRIPTION,
    inputSchema: MANAGE_SCHEMA,
  },
  // The thumbnail is a render and the script an upload of up to 10 MiB, so the
  // transport must outlast both.
  bridgeTimeoutMs: MANAGE_TOOL_TIMEOUT_MS,
  prompt: MANAGE_PROMPT,
  handler: async (args: Record<string, unknown>): Promise<string> => {
    log.info("render", "manageShapeScript: start", { action: args.action, args: Object.keys(args).join(",") });
    const result = await executeManageShapeScript(
      {
        files: shapeFiles,
        gallery: currentGallery(),
        renderThumbnail: (script) => renderShapeThumbnail(script, (message) => log.warn("render", "manageShapeScript: renderer", { message })),
        onWarning: (message) => log.warn("render", "manageShapeScript", { message }),
      },
      args,
    );
    log.info("render", "manageShapeScript: ok", { action: result.action, ...("id" in result ? { id: result.id } : { count: result.posts.length }) });
    return result.message;
  },
};
