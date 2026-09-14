// STL export of a ShapeScript model — the format slicers take for 3D printing.
// STL is geometry only: colours, names and hierarchy are dropped, every
// triangle is written in world space. Browser-safe like the other exporters;
// `STLExporter` touches no DOM at all.

import * as THREE from "three";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import { exportShapeScript, type ExportOptions } from "./model";

/** The MIME type a `.stl` is served / downloaded as (IANA's registration). */
export const STL_MIME_TYPE = "model/stl";

/** The extension an STL carries. */
export const STL_EXTENSION = ".stl";

/** Serialise an already-built Three.js object tree to a binary STL.
 *
 *  `STLExporter` writes every mesh it can traverse to, hidden or not, and reads
 *  each one's `matrixWorld` as it stands. So the tree is flattened first into
 *  the meshes that are actually shown — a `visible = false` anywhere up the
 *  chain hides the subtree, as it does on screen — each placed by its world
 *  matrix. Geometry is shared with the source, so there is nothing to dispose. */
export async function sceneToStl(object: THREE.Object3D): Promise<Uint8Array<ArrayBuffer>> {
  object.updateMatrixWorld(true);
  const flat = new THREE.Group();
  for (const mesh of visibleMeshes(object)) {
    const placed = new THREE.Mesh(mesh.geometry, mesh.material);
    placed.matrixAutoUpdate = false;
    placed.matrix.copy(mesh.matrixWorld);
    flat.add(placed);
  }
  flat.updateMatrixWorld(true);
  const view = new STLExporter().parse(flat, { binary: true }) as DataView;
  return new Uint8Array(view.buffer as ArrayBuffer, view.byteOffset, view.byteLength);
}

/** The meshes under `object` that are shown: none below a hidden node. */
function visibleMeshes(object: THREE.Object3D): THREE.Mesh[] {
  if (!object.visible) return [];
  const own = (object as THREE.Mesh).isMesh ? [object as THREE.Mesh] : [];
  return own.concat(...object.children.map(visibleMeshes));
}

/** Parse, evaluate and export one ShapeScript source as a binary STL. */
export function shapeScriptToStl(script: string, options: ExportOptions = {}): Promise<Uint8Array<ArrayBuffer>> {
  return exportShapeScript(script, sceneToStl, options);
}
