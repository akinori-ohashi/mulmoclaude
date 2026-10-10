// After a server restart an open page holds a token the server no longer
// accepts: the token is regenerated at every start, and the page read it once
// from index.html (#3438). index.html is served without a token and carries
// the current one on every request — the production handler substitutes it
// per request, the Vite plugin does the same for a loopback requester — so the
// page fetches it again instead of asking the user to reload.

import { ref, type Ref } from "vue";
import { errorMessage } from "../errors";
import { getAuthToken, setAuthToken } from "./authToken";
import { extractAuthTokenFromHtml } from "./authTokenHtml";

/** How a recovery ended. `installed`: index.html carried a token other than
 *  the one the page held, and every later call presents it. `unchanged`: it
 *  carried the token the server just refused. `unavailable`: it carried none,
 *  or was not served. `unreachable`: the fetch itself failed. */
export type AuthTokenRecovery = "installed" | "unchanged" | "unavailable" | "unreachable";

/** True once the server refused this page's token and a fresh one could not
 *  be fetched. `AuthTokenStaleBanner` offers a reload while it is set. */
export const authTokenStale: Ref<boolean> = ref(false);

const INDEX_HTML_PATH = "/";
const INDEX_HTML_FETCH_TIMEOUT_MS = 10_000;

/** What a fetched token means for a page holding `held`. */
export function recoveryOutcome(held: string | null, fetched: string | null): Exclude<AuthTokenRecovery, "unreachable"> {
  if (fetched === null) return "unavailable";
  return fetched === held ? "unchanged" : "installed";
}

/** The served index.html, `null` when it could not be fetched at all. A reply
 *  other than 2xx is a server that answered without a token, not an outage. */
async function fetchIndexHtml(): Promise<string | null> {
  const timeoutController = new AbortController();
  const timeoutTimer = setTimeout(() => timeoutController.abort(), INDEX_HTML_FETCH_TIMEOUT_MS);
  try {
    const indexHtmlResponse = await fetch(INDEX_HTML_PATH, { cache: "no-store", signal: timeoutController.signal });
    return indexHtmlResponse.ok ? await indexHtmlResponse.text() : "";
  } catch (err) {
    console.warn(`[authTokenRecovery] could not fetch ${INDEX_HTML_PATH}:`, errorMessage(err));
    return null;
  } finally {
    clearTimeout(timeoutTimer);
  }
}

async function runRecovery(): Promise<AuthTokenRecovery> {
  const html = await fetchIndexHtml();
  if (html === null) return "unreachable";
  const fetchedToken = extractAuthTokenFromHtml(html);
  const outcome = recoveryOutcome(getAuthToken(), fetchedToken);
  if (outcome === "installed") {
    setAuthToken(fetchedToken);
    authTokenStale.value = false;
  } else if (outcome === "unavailable") {
    authTokenStale.value = true;
  }
  return outcome;
}

let inFlightRecovery: Promise<AuthTokenRecovery> | null = null;

/** Fetch index.html again and install the token it carries. Concurrent
 *  callers — every 401 of a burst, plus the socket refusal — share one fetch. */
export function recoverAuthToken(): Promise<AuthTokenRecovery> {
  if (inFlightRecovery === null) {
    inFlightRecovery = runRecovery().finally(() => {
      inFlightRecovery = null;
    });
  }
  return inFlightRecovery;
}
