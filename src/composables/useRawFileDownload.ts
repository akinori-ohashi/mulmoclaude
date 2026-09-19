import { ref, watch, type Ref } from "vue";
import { API_ROUTES } from "../config/apiRoutes";
import { apiFetchRaw } from "../utils/api";
import { saveBlob } from "../utils/blobDownload";
import { workspaceBasename } from "../utils/path/posixPath";

// Fetch a workspace file's bytes through /api/files/raw and hand them to
// the browser as a save. This is the download the binary /
// unsupported-preview fallback needs: "Open in OS" spawns a handler on
// the SERVER's own OS, so in a container or remote deployment there is no
// desktop session for it to reach and the button can never succeed
// (#3213).
//
// A fetch + blob rather than an `<a href download>` because the anchor
// form has no error channel: a 4xx/413 body would be saved to disk under
// the file's own name, so a refusal arrives looking like the file.

/** What a download is saved as when the path carries no last segment. */
const FALLBACK_DOWNLOAD_NAME = "download";

export interface UseRawFileDownloadResult {
  busy: Ref<boolean>;
  error: Ref<string | null>;
  download: () => Promise<void>;
}

export function useRawFileDownload(selectedPath: Ref<string | null>, failureMessage: () => string): UseRawFileDownloadResult {
  const busy = ref(false);
  const error = ref<string | null>(null);

  // A download outlives the selection that started it, and the two must not be
  // allowed to cross: the response for file A arriving while file B is on
  // screen would save A under A's name with B displayed, or write B's error and
  // busy state from A's request. So each attempt takes a sequence number, every
  // state write after an await checks it is still the current one, and a
  // superseded request is aborted rather than left to finish into nothing.
  let currentRequest = 0;
  let inFlight: AbortController | null = null;

  function supersede(): void {
    currentRequest += 1;
    inFlight?.abort();
    inFlight = null;
  }

  // Same reset-on-navigation contract as useOpenInOs: an error from file
  // A must not linger while file B is on screen.
  watch(selectedPath, () => {
    supersede();
    busy.value = false;
    error.value = null;
  });

  async function download(): Promise<void> {
    const path = selectedPath.value;
    if (!path) return;
    supersede();
    const request = currentRequest;
    const controller = new AbortController();
    inFlight = controller;
    busy.value = true;
    error.value = null;
    try {
      const rawResponse = await apiFetchRaw(API_ROUTES.files.raw, { query: { path }, signal: controller.signal });
      if (request !== currentRequest) return;
      if (!rawResponse.ok) {
        error.value = failureMessage();
        return;
      }
      const bytes = await rawResponse.blob();
      if (request !== currentRequest) return;
      saveBlob(bytes, workspaceBasename(path, FALLBACK_DOWNLOAD_NAME));
    } catch {
      // An abort is this composable superseding itself, not a failure the user
      // should be told about — the request that replaced it owns the message.
      if (request !== currentRequest) return;
      error.value = failureMessage();
    } finally {
      if (request === currentRequest) busy.value = false;
    }
  }

  return { busy, error, download };
}
