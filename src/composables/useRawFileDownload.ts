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

  // Same reset-on-navigation contract as useOpenInOs: an error from file
  // A must not linger while file B is on screen.
  watch(selectedPath, () => {
    busy.value = false;
    error.value = null;
  });

  async function download(): Promise<void> {
    const path = selectedPath.value;
    if (!path) return;
    busy.value = true;
    error.value = null;
    try {
      const rawResponse = await apiFetchRaw(API_ROUTES.files.raw, { query: { path } });
      if (!rawResponse.ok) {
        error.value = failureMessage();
        return;
      }
      saveBlob(await rawResponse.blob(), workspaceBasename(path, FALLBACK_DOWNLOAD_NAME));
    } catch {
      error.value = failureMessage();
    } finally {
      busy.value = false;
    }
  }

  return { busy, error, download };
}
