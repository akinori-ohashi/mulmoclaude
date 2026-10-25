import path from "path";
import JSZip from "jszip";
import type { VerifiedScope } from "@mulmoclaude/core/files";
import { resolveWorkspacePath } from "../files/workspace-io.js";
import { artifactScope, lexicallyInside, openArtifactFile, readArtifactFile } from "../files/artifactMount.js";
import { rewriteHtmlAssets } from "./rewriteAssets.js";
import { log } from "../../system/logger/index.js";

const LOG_PREFIX = "share";

export interface PackedFile {
  bundlePath: string;
  bytes: Buffer;
}

// A self-contained bundle: the rewritten entry document plus every
// referenced local asset, ready to zip. `name` is a suggested base
// filename (no extension) derived from the source page.
export interface PackedBundle {
  name: string;
  files: PackedFile[];
}

function stripQueryHash(ref: string): string {
  const cut = ref.search(/[?#]/);
  return cut === -1 ? ref : ref.slice(0, cut);
}

// Reads go through the verified handle (#3573). The lexical check is the form CodeQL's js/path-injection recognises.
async function workspaceTarget(relFromRoot: string): Promise<{ scope: VerifiedScope; inside: string } | null> {
  const root = resolveWorkspacePath(".");
  const inside = lexicallyInside(root, relFromRoot);
  const scope = inside === null ? null : await artifactScope(root, "");
  return scope === null || inside === null ? null : { scope, inside };
}

// The page's own read errors (EACCES …) propagate; only missing, outside or not a regular file is "not found".
async function readPage(htmlRelPath: string): Promise<string> {
  const target = await workspaceTarget(htmlRelPath);
  const handle = target === null ? null : await openArtifactFile(target.scope, target.inside);
  if (handle === null) throw new Error(`HTML not found or outside workspace: ${htmlRelPath}`);
  try {
    return await handle.readFile("utf-8");
  } finally {
    await handle.close();
  }
}

// Resolve a ref (relative to the HTML file's dir) to workspace bytes.
// Returns null when the ref escapes the workspace or the file is
// missing — the caller warns and leaves the (now dangling) link.
async function readAsset(htmlDir: string, originalRef: string): Promise<Buffer | null> {
  const relFromRoot = path.posix.normalize(path.posix.join(htmlDir, stripQueryHash(originalRef)));
  const target = await workspaceTarget(relFromRoot).catch(() => null);
  return target === null ? null : readArtifactFile(target.scope, target.inside);
}

export async function packHtmlBundle(htmlRelPath: string): Promise<PackedBundle> {
  const html = await readPage(htmlRelPath);

  const { html: rewritten, assets } = rewriteHtmlAssets(html);
  const htmlDir = path.posix.dirname(htmlRelPath);

  const files: PackedFile[] = [{ bundlePath: "index.html", bytes: Buffer.from(rewritten, "utf-8") }];
  for (const asset of assets) {
    const bytes = await readAsset(htmlDir, asset.originalRef);
    if (bytes === null) {
      log.warn(LOG_PREFIX, "asset missing or outside workspace; skipped", { ref: asset.originalRef });
      continue;
    }
    files.push({ bundlePath: asset.bundlePath, bytes });
  }

  const name = path.posix.basename(htmlRelPath).replace(/\.html?$/i, "") || "share";
  return { name, files };
}

// Zip a bundle in memory. Bundles are small (one page + a few assets),
// so an in-memory buffer is simpler than streaming and stays testable.
export function zipBundle(files: PackedFile[]): Promise<Buffer> {
  const zip = new JSZip();
  for (const file of files) zip.file(file.bundlePath, file.bytes);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } });
}

export function safeZipName(name: string): string {
  const cleaned = name.replace(/[^\w.-]+/g, "_");
  return `${cleaned || "share"}.zip`;
}

// One-call pack: bundle → zip → suggested download filename. Shared by
// the HTTP route (streams the buffer) and the View dispatch (base64).
export async function packHtmlZip(htmlRelPath: string): Promise<{ filename: string; zip: Buffer }> {
  const bundle = await packHtmlBundle(htmlRelPath);
  const zip = await zipBundle(bundle.files);
  return { filename: safeZipName(bundle.name), zip };
}
