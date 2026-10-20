// LINE's loading animation (POST /v2/bot/chat/loading/start). One-to-one chats
// only; it disappears after `loadingSeconds` or when the bot's next message arrives.

export const LINE_LOADING_URL = "https://api.line.me/v2/bot/chat/loading/start";
// Kept short: a request that crosses the reply re-shows the animation for this long.
export const LINE_LOADING_SECONDS = 10;
export const LINE_LOADING_REFRESH_MS = 8_000;
const LOADING_REQUEST_TIMEOUT_MS = 10_000;

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export async function startLineLoading(fetchFn: FetchFn, channelAccessToken: string, chatId: string): Promise<void> {
  const res = await fetchFn(LINE_LOADING_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${channelAccessToken}`,
    },
    body: JSON.stringify({ chatId, loadingSeconds: LINE_LOADING_SECONDS }),
    signal: AbortSignal.timeout(LOADING_REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`loading/start ${res.status} ${body.slice(0, 200)}`);
  }
}

/** LINE refuses the loading request outside a one-on-one chat, so the bridge does not send it there. */
export function isOneOnOneSource(source: { type?: string } | undefined): boolean {
  return source?.type === "user";
}
