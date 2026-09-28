// `--import` this to make `firebase` unresolvable, so a package entry can be
// loaded the way a consumer WITHOUT the optional peer sees it.
//
// A hook rather than a fixture node_modules tree: Node resolves a package from
// the importer's REAL path, so a temp directory that omits firebase still finds
// the copy this repository installed. Refusing the specifier is the only way to
// reproduce "firebase is not installed" from inside a checkout that has it.
//
// `registerHooks` (synchronous, in-thread) rather than `register` (async, off
// thread): only the synchronous hooks reach `require()`, and the package ships
// a CommonJS build under the `require` condition that has to hold the same
// line. The async kind leaves `require` untouched, so a CJS check built on it
// passes whether or not the entry needs firebase.
//
// The message and `code` mirror Node's own, so a failure here reads the way the
// reported one does.

import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "firebase" || specifier.startsWith("firebase/")) {
      const error = new Error(`Cannot find package 'firebase' imported from ${context.parentURL}`);
      error.code = "ERR_MODULE_NOT_FOUND";
      throw error;
    }
    return nextResolve(specifier, context);
  },
});
