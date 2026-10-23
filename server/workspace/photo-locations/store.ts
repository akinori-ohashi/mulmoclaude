import { makeStoreFiles } from "../../utils/files/store-files.js";
import { WORKSPACE_DIRS, WORKSPACE_PATHS } from "../paths.js";

export const locationsStore = makeStoreFiles(() => WORKSPACE_PATHS.locations, WORKSPACE_DIRS.locations);
