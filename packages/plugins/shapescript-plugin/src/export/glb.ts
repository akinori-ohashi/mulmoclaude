// GLB (binary glTF) export of a ShapeScript model — the format the web, game
// engines and most 3D tools read natively. Like the USDZ exporter it is
// browser-safe: three's `GLTFExporter` reaches for a canvas only to bake
// textures, and the converter's materials are untextured plain colours.
// Vertex-coloured meshes (a `mesh { }` of coloured polygons, a `minkowski`
// result) need no splitting here: glTF carries them as `COLOR_0`, which
// viewers multiply into the material as the spec requires.

import type * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { exportShapeScript, type ExportOptions } from "./model";

/** The MIME type a `.glb` is served / downloaded as (Khronos' registration). */
export const GLB_MIME_TYPE = "model/gltf-binary";

/** The extension a binary glTF carries. */
export const GLB_EXTENSION = ".glb";

/** Serialise an already-built Three.js object tree to a GLB. */
export async function sceneToGlb(object: THREE.Object3D): Promise<Uint8Array<ArrayBuffer>> {
  const exporter = new GLTFExporter();
  const result = await exporter.parseAsync(object, { binary: true });
  return new Uint8Array(result as ArrayBuffer);
}

/** Parse, evaluate and export one ShapeScript source as a GLB. */
export function shapeScriptToGlb(script: string, options: ExportOptions = {}): Promise<Uint8Array<ArrayBuffer>> {
  return exportShapeScript(script, sceneToGlb, options);
}
