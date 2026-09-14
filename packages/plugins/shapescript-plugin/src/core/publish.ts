// The `publishShapeScript` TOOL: post a model to the public gallery on
// mulmoserver (https://server.mulmocast.com/shapes).
//
// What a MODEL sees — name, description, schema, the document a post is —
// lives here so the two hosts cannot drift, exactly as `exportShapeScriptUsdz`
// does. What is deliberately NOT here is Firebase: the gallery is written
// through a small `ShapeGalleryWriter` the host builds over its own remote-host
// session (the server signs into mulmoserver's Firebase AS THE USER — see
// docs/remote-host.md in MulmoClaude), so this entry stays browser-safe and
// the plugin declares no firebase dependency.
//
// The document mirrors mulmoserver's `shapes/{id}` exactly (its
// `src/firestore/shapeShape.ts`): the security rules there pin the key set
// with `hasOnly`, so a key added or dropped on one side is a refused write on
// the other. `SHAPE_POST_KEYS` is the pinned list; a test holds it to the
// rules' order.
//
// The script itself is NOT in the document (receptron/mulmoserver#266): it is
// a Storage object under the post, `text/plain`, and the document carries its
// id as `scriptId`. So a post is three writes — the script, the thumbnail,
// the document — through the same writer, in that order: the required upload
// first, so a failed one leaves nothing behind; the optional picture second,
// where its failure is a warning; and a refused document takes both objects
// back out.
import { disposeObject3D } from "../shapescript/dispose";
import { parseShapeScript } from "../shapescript/parser";
import { astToThreeJS } from "../shapescript/toThreeJS";
import { resolveShapeSource } from "../export/tool";
import type { ShapeScriptDispatchContext } from "./dispatch";

export const PUBLISH_TOOL_NAME = "publishShapeScript";

/** Where the gallery lives. A host may override it (a staging deploy). */
export const SHAPE_GALLERY_URL = "https://server.mulmocast.com";

/** The caps mulmoserver's rules enforce, mirrored so a post is refused here
 *  with a reason rather than there as a bare permission error. */
export const SHAPE_POST_LIMITS = {
  titleMax: 120,
  descriptionMax: 2000,
  /** In UTF-8 BYTES — the script is a Storage object and the gallery's Storage rule caps one
   *  at 10 MiB (`request.resource.size`); a script with Japanese comments is up to three bytes
   *  a character. This is the transport ceiling; what a phone can draw is the practical one. */
  scriptMax: 10 * 1024 * 1024,
  promptMax: 4000,
  authorNameMax: 80,
  keywordsMax: 10,
  keywordMax: 30,
  aiModelMax: 80,
} as const;

export const PUBLISH_DESCRIPTION =
  "Publish a ShapeScript model to the public gallery at server.mulmocast.com/shapes, where anyone can view it in 3D, read the source, download the USDZ and fork it. Takes the same source as presentShapeScript: inline `script`, or `path` to a saved .shape file. Posts under the user's own Google account — the app must be connected to Remote Host (signed in) first — and returns the model's URL. A thumbnail is rendered and attached when the host can rasterise; the post still lands without one. To update a model the user already published, pass its `id` (the tail of its gallery URL): the post is rewritten in place, keeping its URL, and only the account that published it can do so.";

export const PUBLISH_PROMPT =
  "Use publishShapeScript ONLY when the user asks to publish, post or share a model to the gallery — never on your own initiative, since it makes the model public under their name. Before calling it, make sure the model previews correctly (presentShapeScript / renderShapeScript) and give it a short title, a sentence of description and a few lowercase keywords someone would search for. Pass the user's original request as `prompt` so the post records how the model was made, and the model you are running as (its id, e.g. claude-opus-5) as `aiModel` when you know it. To change a model that is already in the gallery — a fix, a new version — pass its `id` rather than publishing a second copy; with `id`, send only the fields that change (a new `script` or `path`, a new `title`, …) and the rest stay as they are. If the tool answers that Remote Host is not connected, tell the user to connect it (the Remote Host control in the app, Google sign-in) and offer to try again.";

/** The tool's JSON schema, in the shape both a gui-chat-protocol
 *  `ToolDefinition` (`parameters`) and an MCP tool (`inputSchema`) take. */
export const PUBLISH_SCHEMA = {
  type: "object" as const,
  properties: {
    id: {
      type: "string",
      description:
        "The id of a post to UPDATE — the tail of its gallery URL, or the id an earlier publishShapeScript call returned. The post is rewritten in place under the same URL; only the account that published it can. With `id` every other field is optional: one given replaces the post's, one omitted keeps it. Omit to publish a new post.",
    },
    title: {
      type: "string",
      description: `The model's title (1–${SHAPE_POST_LIMITS.titleMax} characters). Required for a new post.`,
    },
    script: {
      type: "string",
      description:
        "ShapeScript source to publish. Provide either this or `path`, not both. Required for a new post; with `id`, omit both to keep the model as it is.",
    },
    path: {
      type: "string",
      description:
        "Path to an existing .shape file — an `artifacts/shapes/...` path presentShapeScript saved, or any .shape the host can read. Provide either this or `script`, not both.",
    },
    description: {
      type: "string",
      description: `What the model is, for the gallery page (up to ${SHAPE_POST_LIMITS.descriptionMax} characters). Optional.`,
    },
    keywords: {
      type: "array",
      items: { type: "string" },
      description: `Up to ${SHAPE_POST_LIMITS.keywordsMax} short lowercase tags someone would search for. Optional.`,
    },
    prompt: {
      type: "string",
      description: `The request the model was made from, recorded as its provenance (up to ${SHAPE_POST_LIMITS.promptMax} characters). Optional.`,
    },
    aiModel: {
      type: "string",
      description: `The AI model that wrote the script — the id you are running as, e.g. claude-opus-5 (up to ${SHAPE_POST_LIMITS.aiModelMax} characters). Optional.`,
    },
    published: {
      type: "boolean",
      description: "false saves a draft only the user can see in the gallery's My models. Default true.",
    },
  },
  // `title` and a source are required for a NEW post and optional with `id`; JSON Schema
  // cannot say that, so the descriptions do and the tool refuses a new post without them.
  required: [],
};

/** The document a post is, minus the two server-stamped times the host adds
 *  (`createdAt` / `updatedAt` must be `serverTimestamp()` — the rules refuse
 *  anything else). Every key present with a value: the rules pin the set and
 *  Firestore rejects `undefined`. The script is `scriptId`, the Storage object
 *  `uploadScript` returned — never the text. */
export interface ShapePostDoc {
  uid: string;
  authorName: string;
  title: string;
  description: string;
  scriptId: string;
  /** "prompt" for what this tool posts; "photos" is a post the web editor made from pictures. */
  source: "prompt" | "photos";
  prompt: string;
  photoIds: string[];
  thumbnailId: string;
  forkedFrom: string | null;
  keywords: string[];
  /** The AI model that wrote the script; "" when not said. */
  aiModel: string;
  published: boolean;
}

/** The key set mulmoserver's rules accept, in the rules' own order. */
export const SHAPE_POST_KEYS = [
  "uid",
  "authorName",
  "title",
  "description",
  "scriptId",
  "source",
  "prompt",
  "photoIds",
  "thumbnailId",
  "forkedFrom",
  "keywords",
  "aiModel",
  "published",
] as const;

/** What a host supplies: who is posting, and the writes, over its own
 *  signed-in session — the Firestore document and the Storage object the
 *  gallery card shows. */
export interface ShapeGalleryWriter {
  /** The signed-in user's Firebase uid — the post's owner. */
  uid: string;
  /** The Google display name, as the gallery shows it. Empty is allowed. */
  authorName: string;
  /** Overrides `SHAPE_GALLERY_URL` for the returned link. */
  siteUrl?: string;
  /** Create `shapes/{id}` from `doc` plus the server timestamps. */
  createPost: (id: string, doc: ShapePostDoc) => Promise<void>;
  /** The data of `shapes/{id}` as stored, or null when there is no such post (or the rules
   *  hide it — another account's draft reads as absent). The plugin coerces it. */
  readPost: (id: string) => Promise<Record<string, unknown> | null>;
  /** Merge `patch` into `shapes/{id}` with a server `updatedAt` — a field-level update
   *  (Firestore `updateDoc`), never a whole-document write: a field absent from the patch
   *  must keep what the document holds now. `createdAt` is not sent; the rules freeze it.
   *  CONDITIONAL: the write applies only while the document still matches `expect` — the
   *  owner and the object ids the plugin read — and is refused (throw, with
   *  `POST_CHANGED_MESSAGE` or a cause of the host's own) when it no longer does: a
   *  transaction, so a concurrent edit that replaced the script cannot lose its objects. */
  updatePost: (id: string, patch: ShapePostPatch, expect: ShapePostExpect) => Promise<void>;
  /** Store a PNG under the post and return the object id the document carries. */
  uploadThumbnail: (id: string, png: Uint8Array) => Promise<string>;
  /** Store the ShapeScript source under the post as `SHAPE_SCRIPT_CONTENT_TYPE` and return
   *  the object id the document carries as `scriptId`. */
  uploadScript: (id: string, script: string) => Promise<string>;
  /** Remove an object under the post — the thumbnail or script of a post that was never written. */
  deleteObject: (id: string, objectId: string) => Promise<void>;
}

export interface PublishShapeScriptContext extends ShapeScriptDispatchContext {
  /** null when the host has no signed-in session — the tool then says how to get one. */
  gallery: ShapeGalleryWriter | null;
  /** Rasterise one view of `script` to a PNG, or null where this host cannot
   *  (no headless browser — a Docker image, an install that skipped the
   *  Chromium download). Supplied from `@mulmoclaude/shapescript-plugin/render`.
   *  The picture is best effort because the gallery tolerates its absence: a
   *  card without one shows the model icon, and the post's owner can add one
   *  from the web editor. */
  renderThumbnail: (script: string) => Promise<Uint8Array | null>;
  /** A fault that did not stop the post — a thumbnail that could not be made. */
  onWarning?: (message: string) => void;
}

export interface PublishShapeResult {
  message: string;
  /** The post's id under `shapes/`. */
  id: string;
  /** The model's page. */
  url: string;
  /** Whether a thumbnail was attached. */
  thumbnail: boolean;
}

/** What a host uploads the script as; the gallery's Storage rule admits `text/plain.*`. */
export const SHAPE_SCRIPT_CONTENT_TYPE = "text/plain; charset=utf-8";

/** The header a host puts on every object it uploads under a post. Each has a random id and
 *  is never rewritten, so a browser — and the gallery's CDN, when it has one — may keep it. */
export const SHAPE_OBJECT_CACHE_CONTROL = "public, max-age=31536000, immutable";

/** What `updatePost` must still find on the document for the write to apply: the read the
 *  plugin merged against. Object ids are minted per upload and never reused, so an equal
 *  pair means no other edit replaced the model in between. */
export interface ShapePostExpect {
  uid: string;
  scriptId: string;
  thumbnailId: string;
}

/** The refusal a host raises from `updatePost` when the post no longer matches `expect`. */
export const POST_CHANGED_MESSAGE =
  "The post changed while this update was being prepared (another edit replaced its model); nothing was written — read it again and retry.";

export const NOT_CONNECTED_MESSAGE =
  "Not connected to the gallery: publishing posts under the user's Google account, which needs the app's Remote Host connected (sign in with Google in the Remote Host control), then try again.";

const optionalString = (value: unknown): string | undefined => (typeof value === "string" && value.trim() !== "" ? value : undefined);

const keywordOf = (entry: unknown): string => (typeof entry === "string" ? entry.trim().toLowerCase().slice(0, SHAPE_POST_LIMITS.keywordMax) : "");

/** Keywords as the gallery stores them: trimmed, lowercased, deduplicated,
 *  each cut to `keywordMax`, at most `keywordsMax`. The same rule as
 *  mulmoserver's `normalizeKeywords`, so a tag typed there and one sent from
 *  here can never be two spellings of one word. A comma-separated string is
 *  accepted too, since a model sometimes sends one. */
export function normalizeKeywords(raw: unknown): string[] {
  const entries = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : [];
  const keywords = entries.map(keywordOf).filter((keyword) => keyword !== "");
  return [...new Set(keywords)].slice(0, SHAPE_POST_LIMITS.keywordsMax);
}

function requireLength(name: string, value: string, max: number, min = 0): string {
  if (value.length < min) throw new Error(`\`${name}\` is required`);
  if (value.length > max) throw new Error(`\`${name}\` is too long (${value.length} characters; the gallery allows ${max})`);
  return value;
}

/** The script's limit is in UTF-8 bytes, measured as the Storage rule measures it. */
export function requireScriptBytes(value: string): string {
  if (value.length < 1) throw new Error("`script` is required");
  const bytes = new TextEncoder().encode(value).length;
  if (bytes > SHAPE_POST_LIMITS.scriptMax) throw new Error(`\`script\` is too long (${bytes} bytes; the gallery allows ${SHAPE_POST_LIMITS.scriptMax})`);
  return value;
}

/** The document for one post, built field by field so nothing the caller
 *  passed can reach Firestore uninvited. Throws on a limit the rules would
 *  refuse, naming the field. */
export function shapePostFrom(
  writer: Pick<ShapeGalleryWriter, "uid" | "authorName">,
  fields: {
    title: string;
    /** The object id `uploadScript` returned. */
    scriptId: string;
    description?: string | undefined;
    prompt?: string | undefined;
    keywords?: unknown;
    aiModel?: string | undefined;
    published?: boolean | undefined;
    thumbnailId?: string | undefined;
  },
): ShapePostDoc {
  return {
    uid: writer.uid,
    authorName: writer.authorName.slice(0, SHAPE_POST_LIMITS.authorNameMax),
    title: requireLength("title", fields.title.trim(), SHAPE_POST_LIMITS.titleMax, 1),
    description: requireLength("description", fields.description ?? "", SHAPE_POST_LIMITS.descriptionMax),
    scriptId: fields.scriptId,
    source: "prompt",
    prompt: requireLength("prompt", fields.prompt ?? "", SHAPE_POST_LIMITS.promptMax),
    photoIds: [],
    thumbnailId: fields.thumbnailId ?? "",
    forkedFrom: null,
    keywords: normalizeKeywords(fields.keywords),
    aiModel: requireLength("aiModel", (fields.aiModel ?? "").trim(), SHAPE_POST_LIMITS.aiModelMax),
    published: fields.published !== false,
  };
}

/** The gallery's address for one post. */
export function shapePostUrl(id: string, siteUrl = SHAPE_GALLERY_URL): string {
  const base = siteUrl.endsWith("/") ? siteUrl.slice(0, -1) : siteUrl;
  return `${base}/shapes/${id}`;
}

/** Build and drop the model, so a script the viewer cannot show is refused
 *  here with its diagnostic rather than published broken. */
function requireBuildable(script: string): void {
  disposeObject3D(astToThreeJS(parseShapeScript(script)));
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** The thumbnail's object id, or "" when none could be made — a warning, not a
 *  failure, since the post is what the user asked for. */
async function thumbnailFor(context: PublishShapeScriptContext, gallery: ShapeGalleryWriter, id: string, script: string): Promise<string> {
  try {
    const png = await context.renderThumbnail(script);
    return png ? await gallery.uploadThumbnail(id, png) : "";
  } catch (error) {
    context.onWarning?.(`thumbnail skipped: ${messageOf(error)}`);
    return "";
  }
}

/** Write the post; if that fails, take the script and the thumbnail back out
 *  so a refused write does not leave objects nothing references. */
async function writePost(context: PublishShapeScriptContext, gallery: ShapeGalleryWriter, id: string, doc: ShapePostDoc): Promise<void> {
  try {
    await gallery.createPost(id, doc);
  } catch (error) {
    await discardObjects(context, gallery, id, [doc.scriptId, doc.thumbnailId]);
    throw error;
  }
}

const newPostId = (): string => globalThis.crypto.randomUUID();

const stringOr = (value: unknown, fallback: string): string => (typeof value === "string" ? value : fallback);

/** An existing post as stored, coerced to the document shape: a post from before a key
 *  existed (`keywords`, `aiModel`, `description`) reads as its empty value, so the rewrite
 *  carries every key the rules pin. */
export function existingShapePost(data: Record<string, unknown>): ShapePostDoc {
  return {
    uid: stringOr(data.uid, ""),
    authorName: stringOr(data.authorName, ""),
    title: stringOr(data.title, ""),
    description: stringOr(data.description, ""),
    scriptId: stringOr(data.scriptId, ""),
    source: data.source === "photos" ? "photos" : "prompt",
    prompt: stringOr(data.prompt, ""),
    photoIds: Array.isArray(data.photoIds) ? data.photoIds.filter((entry): entry is string => typeof entry === "string") : [],
    thumbnailId: stringOr(data.thumbnailId, ""),
    forkedFrom: typeof data.forkedFrom === "string" ? data.forkedFrom : null,
    keywords: normalizeKeywords(data.keywords),
    aiModel: stringOr(data.aiModel, ""),
    published: data.published !== false,
  };
}

/** The post `id` names, when it exists and is the session user's own. Refused here with the
 *  reason — the rules would refuse the write too, but only as a bare permission error. */
async function requireOwnPost(gallery: ShapeGalleryWriter, id: string): Promise<ShapePostDoc> {
  const data = await gallery.readPost(id);
  if (!data) throw new Error(`No gallery post has the id "${id}"`);
  const existing = existingShapePost(data);
  if (existing.uid !== gallery.uid) throw new Error(`The post "${id}" was published by another account; only its publisher can update it`);
  return existing;
}

/** The fields an update may send. PARTIAL on purpose: a field the caller did not give is not
 *  sent at all, so the document keeps whatever it holds NOW — not what a read a moment ago
 *  saw. Two clients editing one post cannot then put back each other's replaced objects. */
export type ShapePostPatch = Partial<
  Pick<ShapePostDoc, "title" | "description" | "prompt" | "keywords" | "aiModel" | "published" | "scriptId" | "thumbnailId">
>;

const givenString = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

/** The text fields the caller GAVE — an explicit "" included, which clears one. */
function givenFields(args: Record<string, unknown>): ShapePostPatch {
  return {
    ...(givenString(args.title) === undefined ? {} : { title: args.title as string }),
    ...(givenString(args.description) === undefined ? {} : { description: args.description as string }),
    ...(givenString(args.prompt) === undefined ? {} : { prompt: args.prompt as string }),
    ...(givenString(args.aiModel) === undefined ? {} : { aiModel: args.aiModel as string }),
    ...(args.keywords === undefined ? {} : { keywords: normalizeKeywords(args.keywords) }),
    ...(typeof args.published === "boolean" ? { published: args.published } : {}),
  };
}

/** The update for the user's own post: `doc` is the post as it will read, `patch` what is
 *  sent — only the fields the caller gave (an explicit "" clears one), plus the new object
 *  ids when the source changed. Every value has passed the same limits as a new post, so a
 *  refusal is named here before anything is uploaded. `uid`, `authorName`, `source`,
 *  `photoIds` and `forkedFrom` are never the caller's. */
export function shapePostPatch(
  existing: ShapePostDoc,
  args: Record<string, unknown>,
  objects?: { scriptId: string; thumbnailId: string },
): { doc: ShapePostDoc; patch: ShapePostPatch } {
  const given = givenFields(args);
  const checked = shapePostFrom({ uid: existing.uid, authorName: existing.authorName }, { ...existing, ...given, ...objects });
  const doc: ShapePostDoc = { ...checked, source: existing.source, photoIds: existing.photoIds, forkedFrom: existing.forkedFrom };
  const patch: ShapePostPatch = { ...objects };
  for (const key of Object.keys(given) as Array<keyof ShapePostPatch>) Object.assign(patch, { [key]: doc[key] });
  return { doc, patch };
}

const hasSource = (args: Record<string, unknown>): boolean => optionalString(args.script) !== undefined || optionalString(args.path) !== undefined;

/** A checked script: resolved from `script` / `path`, within the Storage cap, and buildable. */
async function checkedScript(context: PublishShapeScriptContext, args: Record<string, unknown>): Promise<string> {
  const { script } = await resolveShapeSource(context, args);
  requireScriptBytes(script);
  requireBuildable(script);
  return script;
}

/** Upload the script, then its thumbnail, under `id`. The script first: it is required, so a
 *  failed upload must not have a thumbnail to orphan. */
async function uploadObjects(context: PublishShapeScriptContext, gallery: ShapeGalleryWriter, id: string, script: string) {
  const scriptId = await gallery.uploadScript(id, script);
  const thumbnailId = await thumbnailFor(context, gallery, id, script);
  return { scriptId, thumbnailId };
}

/** Best-effort removal of objects nothing references any more; each failure is a warning. */
async function discardObjects(context: PublishShapeScriptContext, gallery: ShapeGalleryWriter, id: string, objectIds: string[]): Promise<void> {
  await Promise.all(
    objectIds
      .filter((objectId) => objectId !== "")
      .map((objectId) => gallery.deleteObject(id, objectId).catch((cause: unknown) => context.onWarning?.(`orphaned object ${objectId}: ${messageOf(cause)}`))),
  );
}

function resultOf(doc: ShapePostDoc, id: string, gallery: ShapeGalleryWriter, state: string): PublishShapeResult {
  const url = shapePostUrl(id, gallery.siteUrl);
  const picture = doc.thumbnailId ? "" : " No thumbnail could be attached; the gallery shows a placeholder until the user edits the post.";
  return { message: `${state}: "${doc.title}" is at ${url}.${picture}`, id, url, thumbnail: doc.thumbnailId !== "" };
}

async function publishNewPost(context: PublishShapeScriptContext, gallery: ShapeGalleryWriter, args: Record<string, unknown>): Promise<PublishShapeResult> {
  const title = optionalString(args.title);
  if (!title) throw new Error("`title` is required");
  const script = await checkedScript(context, args);
  // The document is built first — with a placeholder id — so a limit is named before an upload.
  const post = shapePostFrom(gallery, {
    title,
    scriptId: "",
    description: optionalString(args.description),
    prompt: optionalString(args.prompt),
    keywords: args.keywords,
    aiModel: optionalString(args.aiModel),
    published: args.published !== false,
  });
  const id = newPostId();
  const doc: ShapePostDoc = { ...post, ...(await uploadObjects(context, gallery, id, script)) };
  await writePost(context, gallery, id, doc);
  return resultOf(doc, id, gallery, doc.published ? "Published" : "Saved as a draft (only the user can see it, under My models)");
}

/** Rewrite the user's own post `id`. A new source replaces the script object and the
 *  thumbnail; the replaced objects go once the document points at the new ones, and the new
 *  ones go if the document is refused — either way nothing is left that nothing references.
 *  The write is conditional on the post still carrying the object ids the read saw, so two
 *  edits racing on one post cannot orphan the winner's objects: the loser is refused with
 *  `POST_CHANGED_MESSAGE`, its uploads taken back out. */
async function updateExistingPost(
  context: PublishShapeScriptContext,
  gallery: ShapeGalleryWriter,
  id: string,
  args: Record<string, unknown>,
): Promise<PublishShapeResult> {
  const existing = await requireOwnPost(gallery, id);
  const script = hasSource(args) ? await checkedScript(context, args) : null;
  // Limits are named before any upload: a first merge, without new objects, is the dry run.
  shapePostPatch(existing, args);
  const objects = script === null ? undefined : await uploadObjects(context, gallery, id, script);
  const { doc, patch } = shapePostPatch(existing, args, objects);
  try {
    await gallery.updatePost(id, patch, { uid: existing.uid, scriptId: existing.scriptId, thumbnailId: existing.thumbnailId });
  } catch (error) {
    if (objects) await discardObjects(context, gallery, id, [objects.scriptId, objects.thumbnailId]);
    throw error;
  }
  if (objects) await discardObjects(context, gallery, id, [existing.scriptId, existing.thumbnailId]);
  return resultOf(doc, id, gallery, doc.published ? "Updated" : "Updated as a draft (only the user can see it, under My models)");
}

/**
 * Run one `publishShapeScript` call. Throws on a missing session, a missing or
 * invalid source, a limit the gallery would refuse, and on ShapeScript errors
 * — the host's error path reports those to the model as it does for
 * `renderShapeScript`. Everything that can be refused is checked BEFORE
 * anything is uploaded, so a refusal writes nothing. With `id`, the post is
 * rewritten in place instead — the session user's own post only.
 */
export async function executePublishShapeScript(context: PublishShapeScriptContext, args: Record<string, unknown>): Promise<PublishShapeResult> {
  const gallery = context.gallery;
  if (!gallery) throw new Error(NOT_CONNECTED_MESSAGE);
  const id = optionalString(args.id);
  return id === undefined ? publishNewPost(context, gallery, args) : updateExistingPost(context, gallery, id.trim(), args);
}
