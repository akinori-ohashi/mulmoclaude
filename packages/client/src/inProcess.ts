// A `BridgeClient` that talks to a chat service living in the SAME process,
// with no socket, no port and no bearer token (#3080).
//
// `packages/chat-service/src/relay.ts` calls itself "the shared core of the
// bridge chat flow ... HTTP (router) and socket.io transports both call the
// `RelayFn` this factory returns". This is the third caller of that same core,
// so nothing new is introduced server-side — only a different way in.
//
// The relay and the push registration arrive as callbacks rather than imports:
// `@mulmobridge/client` sits BELOW the server in the dependency direction and
// must not import `@mulmoclaude/chat-service`.

import type { Attachment, BridgeOptions } from "@mulmobridge/protocol";
import type { BridgeClient, MessageAck, PushEvent } from "./client.js";

/** Shape of `chat-service`'s `RelayResult`, restated so this package does not
 *  import the server package. Kept structural on purpose: the host passes its
 *  own function and TypeScript checks the two agree. */
export type InProcessRelayResult = { kind: "ok"; reply: string } | { kind: "error"; status: number; message: string };

export type InProcessRelayFn = (params: {
  transportId: string;
  externalChatId: string;
  text: string;
  attachments?: Attachment[] | undefined;
  bridgeOptions?: Readonly<Record<string, string | number | boolean>> | undefined;
  onChunk?: ((text: string) => void) | undefined;
}) => Promise<InProcessRelayResult>;

/** Registers this bridge to receive server → bridge pushes. Returns the
 *  unregister function, which `close()` calls. */
export type RegisterInProcessPush = (transportId: string, handler: (event: PushEvent) => void) => () => void;

export interface InProcessBridgeClientOptions {
  transportId: string;
  relay: InProcessRelayFn;
  registerPush: RegisterInProcessPush;
  /** Forwarded to the host's `startChat` exactly as the handshake bag is on the
   *  socket path. Defaults to `{}` — an in-process bridge is configured by the
   *  host, so there is no env to scrape on its behalf. */
  options?: BridgeOptions;
}

export function createInProcessBridgeClient(opts: InProcessBridgeClientOptions): BridgeClient {
  const bridgeOptions = opts.options ?? {};
  const pushHandlers: ((event: PushEvent) => void)[] = [];
  const chunkHandlers: ((chunk: string) => void)[] = [];
  let unregisterPush: (() => void) | null = null;
  let closed = false;

  const deliverPush = (event: PushEvent): void => {
    for (const handler of pushHandlers) handler(event);
  };

  const send = async (externalChatId: string, text: string, attachments?: Attachment[]): Promise<MessageAck> => {
    if (closed) return { ok: false, error: "bridge client is closed" };
    const result = await opts.relay({
      transportId: opts.transportId,
      externalChatId,
      text,
      attachments,
      bridgeOptions,
      // Only subscribe the relay to chunks when someone is listening, so the
      // serialiser is not paying for a stream nobody reads.
      onChunk: chunkHandlers.length > 0 ? (chunk) => chunkHandlers.forEach((handler) => handler(chunk)) : undefined,
    });
    return result.kind === "ok" ? { ok: true, reply: result.reply } : { ok: false, error: result.message, status: result.status };
  };

  return {
    send,
    onPush(handler) {
      pushHandlers.push(handler);
      // Registered on the FIRST subscriber so a bridge that never listens costs
      // the host nothing, and only once however many handlers are added.
      unregisterPush ??= opts.registerPush(opts.transportId, deliverPush);
    },
    onTextChunk(handler) {
      chunkHandlers.push(handler);
    },
    // There is no socket, so there is no connection to gain or lose. An
    // in-process bridge is connected from the moment it is constructed.
    onConnect(handler) {
      handler();
    },
    onDisconnect() {},
    close() {
      closed = true;
      unregisterPush?.();
      unregisterPush = null;
      pushHandlers.length = 0;
      chunkHandlers.length = 0;
    },
    get socket(): never {
      // Deliberately loud rather than null. Measured across all 25 bridges: none
      // reads `.socket`, so the first caller to do so is writing new code against
      // an assumption that does not hold here, and a null would surface as an
      // unrelated TypeError somewhere downstream.
      throw new Error("in-process bridge client has no socket — see packages/client/src/inProcess.ts");
    },
  };
}
