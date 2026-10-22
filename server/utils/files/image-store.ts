import path from "path";
import { WORKSPACE_DIRS, WORKSPACE_PATHS } from "../../workspace/paths.js";
import { shortId } from "../id.js";
import { yearMonthUtc } from "@mulmoclaude/core/artifacts";
import { makePathValidator } from "./path-validator.js";
import { makeStoreFiles } from "./store-files.js";

const store = makeStoreFiles(() => WORKSPACE_PATHS.images, WORKSPACE_DIRS.images);

// #764 sharded under images/YYYY/MM/ (UTC). Buffer pass-through avoids re-encoding the PNG bytes.
export async function saveImage(base64Data: string): Promise<string> {
  const partition = yearMonthUtc();
  const relativePath = path.posix.join(WORKSPACE_DIRS.images, partition, `${shortId()}.png`);
  await store.write(relativePath, Buffer.from(base64Data, "base64"));
  return relativePath;
}

export async function overwriteImage(relativePath: string, base64Data: string): Promise<void> {
  await store.write(relativePath, Buffer.from(base64Data, "base64"));
}

export async function loadImageBase64(relativePath: string): Promise<string> {
  return (await store.read(relativePath)).toString("base64");
}

export function stripDataUri(dataUri: string): string {
  return dataUri.replace(/^data:image\/[^;]+;base64,/, "");
}

// Accepts arbitrary depth so saveImage's images/YYYY/MM/abc.png still validates.
export const isImagePath = makePathValidator({ prefix: WORKSPACE_DIRS.images, ext: ".png" });
