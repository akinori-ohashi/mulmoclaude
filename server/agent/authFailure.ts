// The claude CLI marks a failed login with a top-level `error` on the
// synthetic `assistant` frame it emits instead of a reply. Under `-p` the
// CLI's own wording drops the `/login` advice it shows interactively
// ("Failed to authenticate: OAuth session expired and could not be
// refreshed"), so the fix has to be spelled out here or the user is stuck.

export const CLI_AUTH_FAILED_ERROR = "authentication_failed";

const FALLBACK_AUTH_FAILURE_TEXT = "Failed to authenticate.";

export const AUTH_FAILURE_HINT =
  "Run `claude /login` in a terminal on this machine, then send your message again. If you use ANTHROPIC_API_KEY instead, check that the key is valid.";

export function isAuthFailureFrame(event: { type: string; error?: unknown }): boolean {
  return event.type === "assistant" && event.error === CLI_AUTH_FAILED_ERROR;
}

export function authFailureMessage(cliText: string): string {
  const reason = cliText.trim() || FALLBACK_AUTH_FAILURE_TEXT;
  return `${reason}\n${AUTH_FAILURE_HINT}`;
}
