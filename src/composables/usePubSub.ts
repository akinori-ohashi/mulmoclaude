import { io, type Socket } from "socket.io-client";
import { getAuthToken } from "../utils/auth/authToken";
import { authTokenStale, recoverAuthToken } from "../utils/auth/authTokenRecovery";

interface PubSubMessage {
  channel: string;
  data: unknown;
}

type Callback = (data: unknown) => void;
type Unsubscribe = () => void;
type ReconnectHandler = () => void;

// On reconnect we re-emit every live subscription so the rooms list survives the bounce.
let socket: Socket | null = null;

const listeners = new Map<string, Set<Callback>>();
const reconnectHandlers = new Set<ReconnectHandler>();
// First `connect` is the initial establishment; every subsequent one is a
// reconnect and needs a state catch-up (missed events during the down window
// are lost because the pub/sub server has no replay buffer). See #1915.
let hasConnectedOnce = false;

function resendSubscriptions(sock: Socket): void {
  for (const channel of listeners.keys()) {
    sock.emit("subscribe", channel);
  }
}

function fireReconnectHandlers(): void {
  for (const handler of reconnectHandlers) {
    try {
      handler();
    } catch (err) {
      console.error("[usePubSub] reconnect handler threw:", err);
    }
  }
}

/** The server refused the handshake. The token is regenerated at every server
 *  start, so this is what a restart looks like from a page that stayed open;
 *  index.html carries the new token, and `auth` re-reads it on the next
 *  CONNECT. socket.io does not retry a refusal on its own (#3433), so the
 *  reconnect is explicit — and only with a token the server has not refused
 *  yet, so a second refusal ends with the banner rather than a loop (#3438). */
async function reconnectWithFreshToken(refusedSocket: Socket): Promise<void> {
  const recovery = await recoverAuthToken();
  // `maybeDisconnect` may have let go of this socket while index.html was fetched.
  if (socket !== refusedSocket) return;
  if (recovery === "installed") {
    refusedSocket.connect();
    return;
  }
  authTokenStale.value = true;
}

function connect(): Socket {
  if (socket) return socket;

  const sock = io({
    path: "/ws/pubsub",
    // Server refuses long-polling fallback, so fail fast here too if the WS upgrade doesn't go through.
    transports: ["websocket"],
    // The same bearer token every `apiCall` attaches (#3433). A function, so
    // each CONNECT re-reads it instead of re-sending the first value.
    auth: (provide) => provide({ token: getAuthToken() }),
  });

  sock.on("connect", () => {
    authTokenStale.value = false;
    resendSubscriptions(sock);
    if (hasConnectedOnce) {
      fireReconnectHandlers();
    } else {
      hasConnectedOnce = true;
    }
  });

  sock.on("connect_error", (err: Error) => {
    // A transport failure leaves `active` true and socket.io retries it on its
    // own. A refusal from the server middleware destroys the socket (`active`
    // false) and nothing else will retry it.
    if (sock.active) return;
    console.error("[usePubSub] handshake refused by the server:", err.message);
    void reconnectWithFreshToken(sock);
  });

  sock.on("data", (msg: PubSubMessage) => {
    const cbs = listeners.get(msg.channel);
    if (cbs) {
      for (const handler of cbs) handler(msg.data);
    }
  });

  socket = sock;
  return sock;
}

function maybeDisconnect(): void {
  if (listeners.size > 0) return;
  if (!socket) return;
  socket.disconnect();
  socket = null;
  // Reset so the next `connect()` cycle is a true initial connect again —
  // catch-up handlers only make sense against state accumulated on this
  // socket, not across an unsubscribe/resubscribe cycle.
  hasConnectedOnce = false;
}

export function usePubSub() {
  function subscribe(channel: string, callback: Callback): Unsubscribe {
    let entry = listeners.get(channel);
    if (!entry) {
      entry = new Set();
      listeners.set(channel, entry);
    }
    entry.add(callback);

    const sock = connect();
    if (sock.connected) sock.emit("subscribe", channel);
    // If not yet connected, the "connect" handler replays every subscription — no extra bookkeeping needed.

    return () => {
      const cbs = listeners.get(channel);
      if (!cbs) return;
      cbs.delete(callback);
      if (cbs.size === 0) {
        listeners.delete(channel);
        if (socket?.connected) socket.emit("unsubscribe", channel);
      }
      maybeDisconnect();
    };
  }

  // Register a handler that fires on every reconnect (not the initial
  // connect). Callers use this to catch up on missed events after the
  // socket bounces — the pub/sub server has no replay buffer, so anything
  // published during the down window is gone. See #1915.
  function onReconnect(handler: ReconnectHandler): Unsubscribe {
    reconnectHandlers.add(handler);
    return () => {
      reconnectHandlers.delete(handler);
    };
  }

  return { subscribe, onReconnect };
}
