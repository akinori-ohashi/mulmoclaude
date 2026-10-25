// The `/artifacts/*` mounts serve a file only while it sits inside the workspace: the mount folder is
// re-resolved under the workspace on every request, so a folder replaced by a link out is a 404
// rather than the new root, and the file is served from a handle proven to be the in-scope file
// (plans/fix-3573-artifact-mounts.md).

import path from "node:path";
import type { FileHandle } from "node:fs/promises";
import type { Request, RequestHandler, Response } from "express";
import { openVerifiedWithinScope, realpathIfPresent, scopeRealpath, type VerifiedScope } from "@mulmoclaude/core/files";
import { log } from "../../system/logger/index.js";
import { resolveArtifactRequestPath } from "./safe.js";
import { sendFileHandle } from "./sendFileHandle.js";

/** `mountDir` is the mount folder relative to the workspace, e.g. `artifacts/images`; `""` is the workspace itself. */
export async function artifactScope(workspaceRoot: string, mountDir: string): Promise<VerifiedScope | null> {
  const trustedReal = await realpathIfPresent(workspaceRoot);
  return trustedReal === null ? null : { trustedReal, scopeWithinTrusted: mountDir };
}

/** The decoded in-scope path of a request, or null when the mount folder is absent or leads out of the
 *  workspace, or the URL is malformed, escapes, or touches a dotfile. */
export async function artifactRequestPath(scope: VerifiedScope, reqPath: string): Promise<string | null> {
  const scopeReal = await scopeRealpath(scope);
  const decoded = scopeReal === null ? null : resolveArtifactRequestPath(scopeReal, reqPath, true);
  return scopeReal === null || decoded === null ? null : lexicallyInside(scopeReal, decoded);
}

// The `path.relative` form is the containment check CodeQL recognises before the path reaches realpath.
export function lexicallyInside(scopeReal: string, relPath: string): string | null {
  const inside = path.relative(scopeReal, path.resolve(scopeReal, relPath));
  return inside === "" || inside.startsWith("..") || path.isAbsolute(inside) ? null : inside;
}

/** A verified handle on a regular file of the scope; null for anything else. The caller closes it. */
export async function openArtifactFile(scope: VerifiedScope, relPath: string): Promise<FileHandle | null> {
  const handle = await openVerifiedWithinScope(scope, relPath);
  if (handle === null) return null;
  const isFile = await handle.stat().then(
    (stats) => stats.isFile(),
    () => false,
  );
  if (isFile) return handle;
  await handle.close();
  return null;
}

/** Bytes of a regular file of the scope, read through the verified handle; null for anything else or on any error. */
export async function readArtifactFile(scope: VerifiedScope, relPath: string): Promise<Buffer | null> {
  try {
    const handle = await openArtifactFile(scope, relPath);
    if (handle === null) return null;
    try {
      return await handle.readFile();
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

export type ArtifactResponder = (req: Request, res: Response, scope: VerifiedScope, relPath: string) => Promise<void>;

export const sendArtifactFile: ArtifactResponder = async (req, res, scope, relPath) => {
  const handle = await openArtifactFile(scope, relPath);
  if (handle === null) {
    res.status(404).end();
    return;
  }
  await sendFileHandle(req, res, handle, relPath);
};

/** A mount over `workspaceRoot/mountDir` that answers requests matching `extension`; everything else is a 404. */
export function artifactMount(workspaceRoot: string, mountDir: string, extension: RegExp, respond: ArtifactResponder = sendArtifactFile): RequestHandler {
  return async (req, res) => {
    try {
      const scope = extension.test(req.path) ? await artifactScope(workspaceRoot, mountDir) : null;
      const relPath = scope === null ? null : await artifactRequestPath(scope, req.path);
      if (scope === null || relPath === null) {
        res.status(404).end();
        return;
      }
      await respond(req, res, scope, relPath);
    } catch (err) {
      log.warn("artifacts", "could not serve an artifact", { mountDir, path: req.path, error: String(err) });
      if (!res.headersSent) res.status(404).end();
    }
  };
}
