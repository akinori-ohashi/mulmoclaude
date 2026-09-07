// A `BrowserPluginRuntime` that answers without a host.
//
// The demo exists to look at the View, not to exercise the server: `dispatch` records the
// call and reports success, so a save round-trip completes and the View stays on the edit
// the user just made. Anything that would need a real backend answers with an empty result
// rather than throwing, because a thrown dispatch is folded into an error banner and hides
// the UI the demo is there to show.
//
// Written to be liftable: nothing here knows about mulmoscript, so this becomes the shared
// harness when the other plugins get a demo (#2945).

import { ref } from "vue";
import type { BrowserPluginRuntime } from "gui-chat-protocol/vue";

export type DispatchRecord = { kind: string; args: object };

export interface RuntimeStub {
  runtime: BrowserPluginRuntime;
  /** Every dispatch the View made, newest last — shown in the demo so the wiring is visible. */
  calls: DispatchRecord[];
}

const kindOf = (args: object): string => {
  const kind = (args as { kind?: unknown }).kind;
  return typeof kind === "string" ? kind : "(no kind)";
};

export const createRuntimeStub = (respond: (args: object) => unknown = () => ({ ok: true })): RuntimeStub => {
  const calls: DispatchRecord[] = [];
  const runtime = {
    pubsub: { subscribe: () => () => {} },
    locale: ref("en"),
    log: {
      debug: (msg: string) => console.debug("[demo]", msg),
      info: (msg: string) => console.info("[demo]", msg),
      warn: (msg: string) => console.warn("[demo]", msg),
      error: (msg: string) => console.error("[demo]", msg),
    },
    openUrl: (url: string) => window.open(url, "_blank", "noopener,noreferrer"),
    dispatch: (args: object, parse?: (raw: unknown) => unknown) => {
      calls.push({ kind: kindOf(args), args });
      const raw = respond(args);
      return Promise.resolve(parse ? parse(raw) : raw);
    },
  } as unknown as BrowserPluginRuntime;
  return { runtime, calls };
};
