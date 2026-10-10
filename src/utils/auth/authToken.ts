// The bearer token every call presents, read once from index.html at
// bootstrap (`src/main.ts`) and replaced after a server restart
// (`authTokenRecovery.ts`). A module so that `api.ts`, the `/ws/pubsub`
// handshake and the recovery read one value.

let authToken: string | null = null;

export function setAuthToken(token: string | null): void {
  authToken = token;
}

export function getAuthToken(): string | null {
  return authToken;
}
