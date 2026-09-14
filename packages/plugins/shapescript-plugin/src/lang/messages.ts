export interface Messages {
  untitled: string;
  resetCamera: string;
  wireframe: string;
  grid: string;
  parseError: string;
  editSource: string;
  scriptEditorLabel: string;
  applyChanges: string;
  saveError: string;
  downloadUsdz: string;
  /** Downloads the applied model as a binary glTF. */
  downloadGlb: string;
  /** Downloads the applied model as a binary STL. */
  downloadStl: string;
  exportError: string;
  /** Copies the ShapeScript source to the clipboard. */
  copyScript: string;
  /** Transient label after a successful copy. */
  copied: string;
  /** Heading for commands the script used that this viewer does not draw. */
  sceneWarnings: string;
  /** Heading for the script's `print` lines. */
  printOutput: string;
}
