// Read an HTML artifact file under the `/artifacts/html` static
// mount and splice two helper scripts before its closing `</body>`:
//   1. The image-self-repair script (#1011 Stage E / #1025) — restores
//      the behavior that PR #980 unhooked when presentHtml / Files
//      HTML preview moved off `srcdoc` onto the static mount.
//   2. The iframe height reporter (#1219 follow-up) — lets the parent
//      StackView size the iframe to its rendered content despite the
//      `sandbox="allow-scripts"` cross-origin barrier.
//
// Both scripts are pure string injections of trusted server code; the
// helpers are pure functions and order doesn't matter (one-shot scripts
// that observe their own document state).
//
// Lives in its own module — not inline in `server/index.ts` — so unit
// tests can import the helpers without dragging the entire server
// startup as an import side effect.

import { readFile as fsReadFile } from "fs/promises";
import type { VerifiedScope } from "@mulmoclaude/core/files";
import { openArtifactFile } from "../files/artifactMount.js";
import { injectImageRepairScript } from "../../../src/utils/image/imageRepairInlineScript.js";
import { injectHeightReporterScript } from "../../../src/utils/html/iframeHeightReporterScript.js";

const spliceHelperScripts = (raw: string): string => injectHeightReporterScript(injectImageRepairScript(raw));

/** Read an HTML artifact under `scope` through a verified handle and splice the helper scripts.
 *  Null when the file is missing, outside the scope, not a regular file, or unreadable. */
export async function readAndInjectHtmlArtifact(scope: VerifiedScope, relPath: string): Promise<string | null> {
  try {
    const handle = await openArtifactFile(scope, relPath);
    if (handle === null) return null;
    try {
      return spliceHelperScripts(await handle.readFile("utf8"));
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

/** Same splice, for a page the caller has ALREADY resolved to an absolute path.
 *  The `/htmlfile` mount serves pages outside `artifacts/html/` (presentHtml's
 *  `path` form), so there is no root to contain them to — its own resolver
 *  (`htmlFileRequest.ts`) is what vets the request before this point. */
export async function readAndInjectHtmlFile(absPath: string): Promise<string | null> {
  let raw: string;
  try {
    raw = await fsReadFile(absPath, "utf8");
  } catch {
    return null;
  }
  return spliceHelperScripts(raw);
}
