// The two chat entry points in
// packages/plugins/collection-plugin/src/vue/composables/useCollectionChat.ts,
// and the rule they now share: each takes its own full-screen surface down on
// send.
//
// The record's box is the one that did not (#3220). Its panel lives inside a
// `fixed inset-0` overlay — the shared record modal, or the calendar day
// popup — so a host that starts the chat in place (an embedded chat card,
// MulmoTerminal's chat pane) drew it behind the thing the user had just typed
// into, with an emptied textarea as the only feedback.
//
// The ORDER is the part that can silently break: `closeRecord` clears
// `viewing`, and `viewing` is where the `id=` selector comes from. Read it
// after the close and the seed loses its scope while still looking like a
// working chat — so these assert the seed's CONTENTS, not just that something
// was dispatched.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ref } from "vue";

import type { CollectionDetail, CollectionItem, CollectionSchema } from "@mulmoclaude/core/collection";
import { useCollectionChat } from "../../../packages/plugins/collection-plugin/src/vue/composables/useCollectionChat";
import type { CollectionUi } from "../../../packages/plugins/collection-plugin/src/vue/uiContext";

type ChatParams = Parameters<typeof useCollectionChat>[0];

const schema: CollectionSchema = {
  title: "Reading List",
  icon: "bookmark",
  dataPath: "collections/reading-list",
  primaryKey: "id",
  fields: { id: { type: "text", label: "ID" }, notes: { type: "text", label: "Notes" } },
};

const userCollection: CollectionDetail = { slug: "reading-list", title: "Reading List", icon: "bookmark", source: "user", schema };
const feedCollection: CollectionDetail = { ...userCollection, source: "feed" };

const record: CollectionItem = { id: "dune", notes: "reread" };

/** vue-i18n's global `t` is an overload set no plain function satisfies, and
 *  only the feed branch calls it — so the stub echoes the key plus its named
 *  args, which is enough to tell "the feed seed was built" from "the skill
 *  seed was". */
const translateStub = ((key: string, named?: Record<string, unknown>): string =>
  named ? `${key}(${JSON.stringify(named)})` : key) as unknown as ChatParams["t"];

interface Harness {
  chat: ReturnType<typeof useCollectionChat>;
  dispatched: string[];
  closes: number;
  /** Order of events as they happened, so a close that lands before the
   *  dispatch is distinguishable from one that lands after. */
  trace: string[];
  viewing: ChatParams["viewing"];
}

/** `embedded: true` supplies `sendTextMessage` (the chat card's channel into
 *  the running session); otherwise dispatch goes through the host's
 *  `startChat`, as the standalone page does. Both are recorded the same way so
 *  each case can assert the seed regardless of which path carried it. */
function makeHarness(options: { collection?: CollectionDetail | null; viewing?: CollectionItem | null; embedded?: boolean } = {}): Harness {
  const dispatched: string[] = [];
  const trace: string[] = [];
  const state = { closes: 0 };

  const collection = ref<CollectionDetail | null>(options.collection === undefined ? userCollection : options.collection);
  const viewing = ref<CollectionItem | null>(options.viewing === undefined ? record : options.viewing);

  const send = (text: string): void => {
    dispatched.push(text);
    trace.push("dispatch");
  };
  const cui = {
    startChat: (prompt: string) => send(prompt),
    generalRoleId: "general",
  } as unknown as CollectionUi;

  const chat = useCollectionChat({
    collection,
    viewing,
    cui,
    props: options.embedded ? { sendTextMessage: (text?: string) => send(text ?? "") } : {},
    closeRecord: () => {
      state.closes += 1;
      trace.push("close");
      // The real `closeRecordSurfaces` clears the open record (via
      // `closeView`), which is exactly what makes the ordering load-bearing.
      viewing.value = null;
    },
    t: translateStub,
  });

  return {
    chat,
    dispatched,
    trace,
    viewing,
    get closes() {
      return state.closes;
    },
  };
}

describe("useCollectionChat — the record's chat box", () => {
  it("dispatches the record-scoped seed AND closes the record's surface", () => {
    const harness = makeHarness();

    harness.chat.onItemChat("  what else did I like?  ");

    assert.deepEqual(harness.dispatched, ["/reading-list id=dune what else did I like?"]);
    assert.equal(harness.closes, 1, "the record's full-screen overlay must come down, or the chat starts behind it (#3220)");
  });

  it("reads the open record BEFORE closing, so the `id=` selector survives", () => {
    const harness = makeHarness();

    harness.chat.onItemChat("what else did I like?");

    // The close really does clear `viewing` here, and the seed still carries
    // the id — so it was read first. Reading it afterwards yields
    // `/reading-list what else did I like?`: a chat that looks fine and has
    // silently lost its record scope.
    assert.equal(harness.viewing.value, null, "the close must clear the open record, or nothing is dismissed");
    assert.match(harness.dispatched[0] ?? "", /\bid=dune\b/);
    assert.deepEqual(harness.trace, ["close", "dispatch"]);
  });

  it("sends into the running session when embedded, and still closes", () => {
    const harness = makeHarness({ embedded: true });

    harness.chat.onItemChat("what else did I like?");

    assert.deepEqual(harness.dispatched, ["/reading-list id=dune what else did I like?"]);
    assert.equal(harness.closes, 1, "the embedded card is the case the bug was reported on — the card is behind the modal");
  });

  it("scopes a feed's data-only seed to the record too", () => {
    const harness = makeHarness({ collection: feedCollection });

    harness.chat.onItemChat("what else did I like?");

    assert.equal(harness.closes, 1);
    assert.match(harness.dispatched[0] ?? "", /collectionsView\.feedChatSeed/);
    assert.match(harness.dispatched[0] ?? "", /for record .*dune/);
  });

  it("does nothing — no dispatch, no close — when there is no message", () => {
    const harness = makeHarness();

    harness.chat.onItemChat("   ");

    assert.deepEqual(harness.dispatched, []);
    assert.equal(harness.closes, 0, "an empty send must not dismiss the record the user is reading");
  });

  it("does nothing when no record is open", () => {
    const harness = makeHarness({ viewing: null });

    harness.chat.onItemChat("what else did I like?");

    assert.deepEqual(harness.dispatched, []);
    assert.equal(harness.closes, 0);
  });

  it("does nothing before the collection has loaded", () => {
    const harness = makeHarness({ collection: null });

    harness.chat.onItemChat("what else did I like?");

    assert.deepEqual(harness.dispatched, []);
    assert.equal(harness.closes, 0);
  });
});

describe("useCollectionChat — the header's collection chat", () => {
  it("closes its own modal and leaves the open record alone", () => {
    const harness = makeHarness();
    harness.chat.openChat();

    harness.chat.submitChat("  add a book  ");

    assert.deepEqual(harness.dispatched, ["/reading-list add a book"]);
    assert.equal(harness.chat.chatOpen.value, false, "the collection chat modal closes itself on send");
    assert.equal(harness.closes, 0, "the header's chat is not about the open record, so it must not dismiss it");
  });

  it("leaves the modal open on an empty message", () => {
    const harness = makeHarness();
    harness.chat.openChat();

    harness.chat.submitChat("   ");

    assert.deepEqual(harness.dispatched, []);
    assert.equal(harness.chat.chatOpen.value, true);
  });
});
