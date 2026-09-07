/** Message bundle contract for the presentMulmoScript View. Ported from the
 *  host's `pluginMulmoScript.*` vue-i18n keys (plus `common.close` /
 *  `common.cancel`); interpolated / pluralized keys become functions. */
export interface Messages {
  beatCount(count: number): string;
  /** Tab: edit every beat in place. */
  editTab: string;
  /** Tab: the per-beat list, where audio / image / movie generation lives. */
  mediaTab: string;
  movie: string;
  generating: string;
  rendering: string;
  saving: string;
  update: string;
  characters: string;
  drop: string;
  gen: string;
  play: string;
  stop: string;
  playPresentation: string;
  regenerateMovie: string;
  movieGenerationFailed: string;
  pdf: string;
  regeneratePdf: string;
  generatingPdf: string;
  retry: string;
  errPrefix: string;
  noBeats: string;
  editSource: string;
  applyChanges: string;
  generateAll: string;
  orDropImage: string;
  generate: string;
  generateAudio: string;
  saveErrorInvalidJson(error: string): string;
  saveErrorSaveFailed(error: string): string;
  close: string;
  cancel: string;
}
