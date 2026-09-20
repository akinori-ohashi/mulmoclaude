// The collection's chat entry points: the header "chat about this collection"
// modal and the open record's "chat about this record" box. Both build a chat
// seed from the current view — a skill-backed collection seeds its `/<slug>`
// command, a data-only feed points the agent at its schema + records — and
// dispatch it into the current session (embedded chat card) or a new General
// chat (standalone page). Both then take their own surface down, because both
// are full-screen (`fixed inset-0`) and a host that starts the chat in place
// would otherwise draw it behind the overlay the user just typed into.
//
// Extracted from CollectionView as a reactive shell; the skill-seed shape lives
// in core (`skillCommandSeed`).

import { ref, type Ref } from "vue";
import { rowIdOf, skillCommandSeed, type CollectionDetail, type CollectionItem } from "@mulmoclaude/core/collection";
import type { CollectionUi } from "../uiContext";
import type { useCollectionI18n } from "../lang";

type Translate = ReturnType<typeof useCollectionI18n>["t"];

interface UseCollectionChatParams {
  collection: Ref<CollectionDetail | null>;
  viewing: Ref<CollectionItem | null>;
  cui: CollectionUi;
  /** The chat card's channel into the current session (embedded mode only). */
  props: { sendTextMessage?: ((text?: string) => void) | undefined };
  /** Dismiss every full-screen surface the open record sits in. The record's
   *  chat box lives inside one (`fixed inset-0`), so a chat seeded from it
   *  starts behind the overlay unless the caller takes it down. Owned by the
   *  view because clearing `viewing` alone is not enough: the `?selected=`
   *  query would reopen it, and an embedded card needs its `select(null)`. */
  closeRecord: () => void;
  t: Translate;
}

export interface UseCollectionChat {
  chatOpen: Ref<boolean>;
  openChat: () => void;
  closeChat: () => void;
  submitChat: (raw: string) => void;
  onItemChat: (message: string) => void;
}

export function useCollectionChat({ collection, viewing, cui, props, closeRecord, t }: UseCollectionChatParams): UseCollectionChat {
  const chatOpen = ref(false);

  /** Open the chat modal. The modal owns its draft + focus: it remounts on every
   *  open (parent `v-if`), so it starts blank and self-focuses. */
  function openChat(): void {
    chatOpen.value = true;
  }

  function closeChat(): void {
    chatOpen.value = false;
  }

  /** Build the chat seed text for the current view. A collection IS a skill, so
   *  its slug doubles as a slash command (`/<slug> <message>`). A feed is
   *  data-only — no skill — so point the agent at the feed's schema + records
   *  instead. Checked via `source` directly (not the `isFeed` computed) to keep
   *  this self-contained. */
  function buildChatSeed(slug: string, message: string, itemId?: string): string {
    const current = collection.value;
    if (current?.source !== "feed") return skillCommandSeed(slug, message, itemId);
    const dataPath = current.schema.dataPath ?? `data/feeds/${slug}`;
    const scoped = itemId ? `(for record \`${itemId}\`) ${message}` : message;
    return t("collectionsView.feedChatSeed", { slug, dataPath, message: scoped });
  }

  /** Dispatch a seed: into the current session when embedded, else a new chat. */
  function dispatchSeed(text: string): void {
    if (props.sendTextMessage) {
      props.sendTextMessage(text);
      return;
    }
    cui.startChat(text, cui.generalRoleId);
  }

  /** Start a chat seeded from the current view. `raw` is the modal's untrimmed
   *  textarea text. */
  function submitChat(raw: string): void {
    if (!collection.value) return;
    const message = raw.trim();
    if (!message) return;
    closeChat();
    dispatchSeed(buildChatSeed(collection.value.slug, message));
  }

  /** The open record's chat box: start a chat scoped to that one record. Seeds
   *  the collection's skill command with an `id=<itemId>` selector so the agent
   *  acts on this record, then takes the record's overlay down — mirroring
   *  `submitChat`, which closes its own modal. The seed is built BEFORE the
   *  close: `closeRecord` clears `viewing`, which is where the id comes from. */
  function onItemChat(message: string): void {
    if (!collection.value || !viewing.value) return;
    const text = message.trim();
    if (!text) return;
    const itemId = rowIdOf(collection.value.schema.primaryKey, viewing.value);
    const seed = buildChatSeed(collection.value.slug, text, itemId || undefined);
    closeRecord();
    dispatchSeed(seed);
  }

  return { chatOpen, openChat, closeChat, submitChat, onItemChat };
}
