// Exit codes shared by the backend and the processes that supervise it
// (`scripts/dev-server.mjs`). Plain `.mjs` so the supervisor, which runs
// without tsx, can import the same constant the server exits with.

// sysexits.h EX_CONFIG: the backend cannot start until the user fixes its
// setup (e.g. logs in again). Restarting would only repeat the failure, and
// for credentials each repeat can spend a billed Claude session.
export const EXIT_CODE_NEEDS_USER_ACTION = 78;
