import type { Messages } from "./messages";

const en: Messages = {
  reload: "Reload from disk",
  saveAsPdf: "Save as PDF (opens print dialog)",
  pdf: "PDF",
  download: "ZIP",
  downloadZip: "Download as a self-contained zip (assets bundled)",
  downloadError: (error) => `⚠ Download failed: ${error}`,
  untitled: "HTML Page",
  editSource: "Edit HTML Source",
  cancel: "Cancel",
  applyChanges: "Apply Changes",
  saving: "Saving...",
  saveError: (error) => `⚠ Save failed: ${error}`,
  loadingSource: "Loading source…",
  sourceError: (error) => `Failed to load source: ${error}`,
  submitTitle: "Send this to the conversation?",
  submitHint: "The page wants to send this. Edit it if needed — nothing is sent until you press Send.",
  submitSend: "Send",
  submitDiscard: "Discard",
  submitTooLong: (maxChars) => `The page tried to send more than ${maxChars} characters, so nothing was sent.`,
};

export default en;
