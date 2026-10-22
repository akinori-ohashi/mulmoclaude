export interface Messages {
  reload: string;
  saveAsPdf: string;
  pdf: string;
  download: string;
  downloadZip: string;
  downloadError(error: string): string;
  untitled: string;
  editSource: string;
  cancel: string;
  applyChanges: string;
  saving: string;
  saveError(error: string): string;
  loadingSource: string;
  sourceError(error: string): string;
  submitTitle: string;
  submitHint: string;
  submitSend: string;
  submitDiscard: string;
  submitTooLong(maxChars: number): string;
  submitSent: string;
  submitFailed: string;
}
