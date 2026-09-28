// @mulmoclaude/core/collection/server — node-only collection engine.
//
// The host server imports from here (storage, validation, discovery, …);
// it is kept separate from the isomorphic `./collection` entry so the frontend
// bundle never pulls in node:fs. Configure the host binding once at startup:
//   import { configureCollectionHost } from "@mulmoclaude/core/collection/server";
//   configureCollectionHost({ workspaceRoot, log });
//
// ── The multi-root contract (read before adding an entry point) ────────────
//
// The engine is root-PARAMETERIZED, not root-bound. Every exported entry point
// that touches the filesystem MUST accept a root override — `opts.workspaceRoot`
// for the options-object calls, an explicit parameter otherwise — and resolve it
// as `opts.workspaceRoot ?? getWorkspaceRoot()`. The host binding is a DEFAULT,
// never the source of truth.
//
// This is load-bearing, not style. MulmoClaude has one workspace, so a call that
// reads the ambient root directly looks correct there forever. MulmoTerminal
// serves N project roots off the same process: there the same call does not
// crash — it reads or writes the WRONG project's data, silently, with types and
// tests green. A host that wants that failure to be loud binds
// `workspaceRoot: null` (explicit-root mode), after which `getWorkspaceRoot()`
// throws instead of guessing.
//
// Two consequences worth stating:
//   - Anything derived from the root (a dataDir, a containment check, a change
//     payload's `root`) must come from the SAME root the call was given. Never
//     reconstruct a root from an absolute path by string surgery.
//   - No helper may close over the ambient root on a caller's behalf. That is
//     why `isContainedInWorkspace()` was deleted rather than kept — see the
//     note in `paths.ts`.
//
// `test/collection/test_multiRoot.ts` pins this: it drives a representative set
// of entry points against a tmpdir root under a null-root host and asserts the
// configured workspace is never touched. A new entry point that reads the
// ambient root fails it.

export {
  configureCollectionHost,
  canonicalRoot,
  getWorkspaceRoot,
  peekWorkspaceRoot,
  COLLECTION_ROOT_REQUIRED,
  log,
  setCollectionChangePublisher,
  publishCollectionChange,
  collectionChangePayload,
  sharedCollectionChangePayload,
  collectionChangeKey,
  localCollectionKey,
  type CollectionHost,
  type CollectionLogger,
  type CollectionChangePayload,
  firestoreHandle,
  setFirestoreAccessor,
  hostSupportsSharedCollections,
  setSharedCollectionsSupport,
  type FirestoreHandle,
  type LocalCollectionChange,
  type SharedCollectionChange,
} from "./host";
// ── `firebase` is an OPTIONAL peer, and this entry must not need it ───────
//
// NOTHING REACHABLE FROM HERE MAY IMPORT `firebase/*` AT TOP LEVEL. Not just
// this file: an ESM import links eagerly, so one SDK import anywhere in the
// graph below makes the peer required for every consumer of this entry —
// including a host with no Firestore at all, which then cannot load the entry
// at all. The failure is a load-time `ERR_MODULE_NOT_FOUND`, and it does not
// show up in `typecheck` (types erase) or in this repo's tests (this repo has
// firebase installed).
//
// Stating it is not enough — it was stated here and broken seven lines down
// (#3263: `firestoreStore.ts` imported `Timestamp`, and `store.ts` names that
// module in the backend registry, so `export * from "./store"` carried it).
// `test/workspace/collections/test_optionalFirebasePeer.ts` loads this entry
// with `firebase` made unresolvable, which is the only check that notices.
//
// So: `createFirestoreDocs` ships from the dedicated
// `@mulmoclaude/core/collection/firestore` subpath, whose NAME says it needs
// the SDK. Types are safe here — they erase at build time. A value that needs
// an SDK call goes through the `FirestoreDocs` seam, which the host injects.
export type { FirestoreDoc, FirestoreDocs } from "./firestoreDocs";
export { sharedItemsPath } from "./firestoreStore";
export { loadAppManifest, parseAppManifest, appManifestReason, APP_MANIFEST_FILE, type AppManifest, type AppManifestResult } from "./appManifest";
// NOTE: the shared-app COMPILER is not here. `app.json` -> the documents a
// published app is made of (`projectApp` / `projectAppViews` / `projectDeploy`
// / `projectPublish`), the declaration it parses (`AuthoredAppZ`) and the gate
// that refuses one (`publishProblems`) live in `receptron/sharedapp`, which
// MulmoTerminal and MulmoServer consume by git ref.
//
// They moved because they had no consumer in this monorepo — MulmoClaude
// neither writes nor reads a shared collection — and every change to them was
// a release of this package that somebody had to publish by hand. What stays
// here is the collection RUNTIME (discovery, the store, the Firestore backend,
// the host seam), which MulmoClaude does use.
//
// mulmoterminal plans/refactor-shared-app-module.md

export type { LoadedCollection } from "./discoveredCollection";
export * from "./paths";
export * from "./templatePath";
export * from "./io";
export * from "./skillAssets";
export * from "./store";
export { BackendUnavailableError, isBackendUnavailable } from "./backendAvailability";
export { MAX_CSV_ROWS, encodeCsvRecordId, decodeCsvRecordId, normalizeCsvValue, csvRowToItem, dedupeByRecordId } from "./csvStore";
export { compileCsvQuery, compileJsonlQuery } from "./csvQuery";
export { runQueryOverRows } from "./jsonlQuery";
export { runCollectionQuery } from "./queryRunner";
export { CollectionQueryZ, MAX_QUERY_ROWS, DEFAULT_QUERY_ROWS } from "../core/queryZ";
export type { CollectionQuery, CollectionQueryAggregate, CollectionQueryOrder, CollectionQueryWhere } from "../core/queryZ";
export * from "./validate";
export * from "./mutate";
export * from "./discovery";
export * from "./ontology";
export * from "./derive";
export * from "./dynamicIcon";
export * from "./spawn";
export * from "./delete";
export * from "./views";
export * from "./manageTool";
